#include "root.h"

#include "BunInspectorSession.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>

#include "InspectorLifecycleAgent.h"
#include "InspectorTestReporterAgent.h"
#include "InspectorBunFrontendDevServerAgent.h"
#include "InspectorHTTPServerAgent.h"

#include <limits>
#include <mutex>
#include <optional>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);
extern "C" void Bun__ensureDebugger(WebCore::ScriptExecutionContextIdentifier scriptId, bool pauseOnStart);

namespace Bun {
using namespace JSC;
using namespace WebCore;

namespace {

// We only need a *top-level* "id": <number> extractor.
// This must be conservative: never "find" an id inside nested objects/arrays
// (e.g. params/result contain many "...Id" fields).
//
// If parsing fails or the message isn't a JSON object, we return std::nullopt.
// That means "treat as event / forward" in sendMessageToFrontend.
//
// This keeps correctness: we only DROP messages when we can *prove* they are
// a response with an id that this session didn't initiate.

template<typename CharType>
ALWAYS_INLINE bool isJSONWhitespace(CharType c)
{
    return c == static_cast<CharType>(' ')
        || c == static_cast<CharType>('\n')
        || c == static_cast<CharType>('\r')
        || c == static_cast<CharType>('\t');
}

template<typename CharType>
ALWAYS_INLINE bool isJSONDigit(CharType c)
{
    return c >= static_cast<CharType>('0') && c <= static_cast<CharType>('9');
}

template<typename CharType>
static bool skipJSONString(const CharType* chars, size_t length, size_t& i)
{
    // assumes chars[i] == '"'
    i++; // skip opening quote
    while (i < length) {
        CharType c = chars[i];
        if (c == static_cast<CharType>('\\')) {
            // Skip escape + escaped char (enough to avoid treating \" as terminator).
            i++;
            if (i >= length)
                return false;
            i++;
            continue;
        }

        if (c == static_cast<CharType>('"')) {
            i++; // skip closing quote
            return true;
        }

        i++;
    }
    return false;
}

template<typename CharType>
static bool skipJSONComposite(const CharType* chars, size_t length, size_t& i)
{
    // assumes chars[i] is '{' or '['
    WTF::Vector<CharType, 8> stack;
    stack.append(chars[i] == static_cast<CharType>('{') ? static_cast<CharType>('}') : static_cast<CharType>(']'));
    i++; // skip opening brace/bracket

    while (i < length) {
        CharType c = chars[i];

        if (c == static_cast<CharType>('"')) {
            if (!skipJSONString(chars, length, i))
                return false;
            continue;
        }

        if (c == static_cast<CharType>('{')) {
            stack.append(static_cast<CharType>('}'));
            i++;
            continue;
        }

        if (c == static_cast<CharType>('[')) {
            stack.append(static_cast<CharType>(']'));
            i++;
            continue;
        }

        if (c == static_cast<CharType>('}') || c == static_cast<CharType>(']')) {
            if (stack.isEmpty() || c != stack.last())
                return false;
            stack.removeLast();
            i++;
            if (stack.isEmpty())
                return true;
            continue;
        }

        i++;
    }

    return false;
}

template<typename CharType>
static bool skipJSONValue(const CharType* chars, size_t length, size_t& i)
{
    if (i >= length)
        return false;

    CharType c = chars[i];

    if (c == static_cast<CharType>('"'))
        return skipJSONString(chars, length, i);

    if (c == static_cast<CharType>('{') || c == static_cast<CharType>('['))
        return skipJSONComposite(chars, length, i);

    // true / false / null
    if (c == static_cast<CharType>('t')) {
        // true
        if (i + 3 < length
            && chars[i + 1] == static_cast<CharType>('r')
            && chars[i + 2] == static_cast<CharType>('u')
            && chars[i + 3] == static_cast<CharType>('e')) {
            i += 4;
            return true;
        }
        return false;
    }

    if (c == static_cast<CharType>('f')) {
        // false
        if (i + 4 < length
            && chars[i + 1] == static_cast<CharType>('a')
            && chars[i + 2] == static_cast<CharType>('l')
            && chars[i + 3] == static_cast<CharType>('s')
            && chars[i + 4] == static_cast<CharType>('e')) {
            i += 5;
            return true;
        }
        return false;
    }

    if (c == static_cast<CharType>('n')) {
        // null
        if (i + 3 < length
            && chars[i + 1] == static_cast<CharType>('u')
            && chars[i + 2] == static_cast<CharType>('l')
            && chars[i + 3] == static_cast<CharType>('l')) {
            i += 4;
            return true;
        }
        return false;
    }

    // number (skip permissively)
    if (c == static_cast<CharType>('-') || isJSONDigit(c)) {
        i++;
        while (i < length) {
            CharType nc = chars[i];
            if (isJSONDigit(nc)
                || nc == static_cast<CharType>('.')
                || nc == static_cast<CharType>('e')
                || nc == static_cast<CharType>('E')
                || nc == static_cast<CharType>('+')
                || nc == static_cast<CharType>('-')) {
                i++;
                continue;
            }
            break;
        }
        return true;
    }

    return false;
}

template<typename CharType>
static std::optional<int> extractTopLevelIdImpl(const CharType* chars, size_t length)
{
    size_t i = 0;

    // Skip leading whitespace.
    while (i < length && isJSONWhitespace(chars[i]))
        i++;

    if (i >= length || chars[i] != static_cast<CharType>('{'))
        return std::nullopt;

    i++; // skip '{'

    while (i < length) {
        // Skip whitespace between tokens.
        while (i < length && isJSONWhitespace(chars[i]))
            i++;

        if (i >= length)
            return std::nullopt;

        // End of object.
        if (chars[i] == static_cast<CharType>('}'))
            return std::nullopt;

        // Be tolerant of stray commas (shouldn't happen for valid JSON, but harmless here).
        if (chars[i] == static_cast<CharType>(',')) {
            i++;
            continue;
        }

        // Expect key string.
        if (chars[i] != static_cast<CharType>('"'))
            return std::nullopt;

        // Parse key string, checking if it's exactly "id" (no escapes).
        i++; // skip opening quote
        bool keyMaybeId = true;
        bool keyHasEscape = false;
        unsigned keyLen = 0;

        while (i < length) {
            CharType c = chars[i];

            if (c == static_cast<CharType>('\\')) {
                keyHasEscape = true;

                // skip escape + escaped char
                i++;
                if (i >= length)
                    return std::nullopt;
                i++;

                // An escaped key cannot be exactly plain "id" in our fast path.
                keyMaybeId = false;
                keyLen += 2;
                continue;
            }

            if (c == static_cast<CharType>('"'))
                break;

            if (keyMaybeId) {
                if (keyLen == 0) {
                    if (c != static_cast<CharType>('i'))
                        keyMaybeId = false;
                } else if (keyLen == 1) {
                    if (c != static_cast<CharType>('d'))
                        keyMaybeId = false;
                } else {
                    keyMaybeId = false;
                }
            }

            keyLen++;
            i++;
        }

        if (i >= length || chars[i] != static_cast<CharType>('"'))
            return std::nullopt;

        i++; // skip closing quote

        // Skip whitespace and expect ':'
        while (i < length && isJSONWhitespace(chars[i]))
            i++;

        if (i >= length || chars[i] != static_cast<CharType>(':'))
            return std::nullopt;

        i++; // skip ':'

        while (i < length && isJSONWhitespace(chars[i]))
            i++;

        if (i >= length)
            return std::nullopt;

        bool keyIsId = keyMaybeId && !keyHasEscape && keyLen == 2;

        if (keyIsId) {
            // Parse integer id.
            bool negative = false;
            if (chars[i] == static_cast<CharType>('-')) {
                negative = true;
                i++;
                if (i >= length)
                    return std::nullopt;
            }

            if (!isJSONDigit(chars[i]))
                return std::nullopt;

            int64_t value = 0;
            while (i < length && isJSONDigit(chars[i])) {
                value = value * 10 + (static_cast<int64_t>(chars[i]) - static_cast<int64_t>('0'));
                if (value > static_cast<int64_t>(std::numeric_limits<int>::max()))
                    return std::nullopt;
                i++;
            }

            if (negative)
                value = -value;

            // If this is not a pure integer token, be conservative and pretend we didn't parse an id.
            if (i < length) {
                CharType nc = chars[i];
                if (nc == static_cast<CharType>('.')
                    || nc == static_cast<CharType>('e')
                    || nc == static_cast<CharType>('E')) {
                    return std::nullopt;
                }
            }

            return static_cast<int>(value);
        }

        // Skip the value for non-id keys.
        if (!skipJSONValue(chars, length, i))
            return std::nullopt;

        // Continue to next pair (comma or end brace).
        while (i < length && isJSONWhitespace(chars[i]))
            i++;

        if (i < length && chars[i] == static_cast<CharType>(','))
            i++;
        else if (i < length && chars[i] == static_cast<CharType>('}'))
            return std::nullopt;
        // else: invalid JSON; loop will eventually bail out safely.
    }

    return std::nullopt;
}

static std::optional<int> extractTopLevelMessageId(const WTF::String& message)
{
    if (message.isEmpty())
        return std::nullopt;

    if (message.is8Bit()) {
        const auto span = message.span8();
        return extractTopLevelIdImpl(span.data(), span.size());
    }

    const auto span = message.span16();
    return extractTopLevelIdImpl(span.data(), span.size());
}

} // anonymous namespace

BunInProcessInspectorSession::BunInProcessInspectorSession(ScriptExecutionContext& context, JSC::JSGlobalObject* globalObject, bool shouldRefEventLoop, JSFunction* onMessageFn)
    : Inspector::FrontendChannel()
    , globalObject(globalObject)
    , scriptExecutionContextIdentifier(context.identifier())
    , refEventLoopWhileConnected(shouldRefEventLoop)
{
    auto& vm = JSC::getVM(globalObject);
    jsOnMessageFunction = { vm, onMessageFn };
}

BunInProcessInspectorSession::~BunInProcessInspectorSession() = default;

Inspector::FrontendChannel::ConnectionType BunInProcessInspectorSession::connectionType() const
{
    return ConnectionType::Local;
}

void BunInProcessInspectorSession::connect()
{
    ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [session = this](ScriptExecutionContext& context) {
        if (session->status != InProcessSessionStatus::Pending)
            return;
        session->doConnect(context);
    });
}

void BunInProcessInspectorSession::disconnect()
{
    switch (status.load()) {
    case InProcessSessionStatus::Disconnected:
        return;
    default:
        break;
    }

    status = InProcessSessionStatus::Disconnecting;

    ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [session = this](ScriptExecutionContext& context) {
        if (session->status == InProcessSessionStatus::Disconnected)
            return;

        session->status = InProcessSessionStatus::Disconnected;

        // Clear pending ids so we don't keep memory or accidentally match stale ids.
        {
            Locker<Lock> locker(session->pendingRequestIdsLock);
            session->m_pending_request_ids.clear();
        }

        // Drop any already-buffered messages; after disconnect, JS shouldn't see more traffic.
        {
            Locker<Lock> locker(session->pendingMessagesLock);
            session->pendingMessages.clear();
        }

        if (session->hasEverConnected) {
            session->inspector().disconnect(*session);
        }

        if (session->refEventLoopWhileConnected) {
            session->refEventLoopWhileConnected = false;
            Bun__eventLoop__incrementRefConcurrently(static_cast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(), -1);
        }
    });
}

void BunInProcessInspectorSession::dispatchMessageFromSession(const WTF::String& message)
{
    WTF::String msgCopy = message.isolatedCopy();
    ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [session = this, msgCopy = WTFMove(msgCopy)](ScriptExecutionContext& context) mutable {
        if (session->status != InProcessSessionStatus::Connected)
            return;

        // Track outgoing request ids for native routing.
        // Note: correctness relies on JS using a process-wide id counter (hybrid fix part 1),
        // so only the owning session will have the id in its pending set.
        if (auto id = extractTopLevelMessageId(msgCopy)) {
            Locker<Lock> locker(session->pendingRequestIdsLock);
            session->m_pending_request_ids.add(*id);
        }

        auto* targetGlobal = context.jsGlobalObject();
        auto& dispatcher = targetGlobal->inspectorDebuggable();
        dispatcher.dispatchMessageFromRemote(WTFMove(msgCopy));
    });
}

void BunInProcessInspectorSession::sendMessageToFrontend(const WTF::String& message)
{
    if (message.isEmpty())
        return;

    // If we're not connected, drop everything.
    if (status.load() != InProcessSessionStatus::Connected)
        return;

    // Hybrid fix (part 2): native response routing.
    //
    // - Responses have a top-level numeric "id".
    // - Events do NOT have "id".
    //
    // Only drop when we can *confidently* parse a top-level id and it does not belong
    // to this session.
    if (auto id = extractTopLevelMessageId(message)) {
        bool ownedByThisSession = false;
        {
            Locker<Lock> locker(pendingRequestIdsLock);
            // remove() returns true if the element was present.
            ownedByThisSession = m_pending_request_ids.remove(*id);
        }

        if (!ownedByThisSession) {
            // Not ours: avoid isolating/copying, avoid buffering, avoid scheduling JS task.
            return;
        }
    }

    {
        Locker<Lock> locker(pendingMessagesLock);
        pendingMessages.append(message.isolatedCopy());
    }

    // Schedule a flush on the context thread to avoid reentrancy.
    if (pendingMessageScheduledCount++ == 0) {
        ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [session = this](ScriptExecutionContext& context) {
            session->flushPendingMessages(context);
        });
    }
}

void BunInProcessInspectorSession::doConnect(ScriptExecutionContext& context)
{
    status = InProcessSessionStatus::Connected;
    auto* targetGlobal = context.jsGlobalObject();

    // Ensure inspector controller/debuggable exist (but do not re-initialize if already present).
    if (!targetGlobal->m_inspectorController || !targetGlobal->m_inspectorDebuggable) {
        Bun__ensureDebugger(context.identifier(), false);
        targetGlobal = context.jsGlobalObject();
    }

    if (refEventLoopWhileConnected) {
        Bun__eventLoop__incrementRefConcurrently(static_cast<Zig::GlobalObject*>(targetGlobal)->bunVM(), 1);
    }

    targetGlobal->setInspectable(true);
    auto& dbg = targetGlobal->inspectorDebuggable();
    dbg.setInspectable(true);

    static std::once_flag agentsRegisteredFlag;
    std::call_once(agentsRegisteredFlag, [&]() {
        targetGlobal->inspectorController().registerAlternateAgent(
            WTF::makeUnique<Inspector::InspectorLifecycleAgent>(*targetGlobal));
        targetGlobal->inspectorController().registerAlternateAgent(
            WTF::makeUnique<Inspector::InspectorTestReporterAgent>(*targetGlobal));
        targetGlobal->inspectorController().registerAlternateAgent(
            WTF::makeUnique<Inspector::InspectorBunFrontendDevServerAgent>(*targetGlobal));
        targetGlobal->inspectorController().registerAlternateAgent(
            WTF::makeUnique<Inspector::InspectorHTTPServerAgent>(*targetGlobal));
    });

    hasEverConnected = true;
    // Match the remote behavior (treat as "automatic" connection).
    targetGlobal->inspectorController().connectFrontend(*this, true, false);
}

JSC::JSGlobalObjectDebuggable& BunInProcessInspectorSession::inspector()
{
    return globalObject->inspectorDebuggable();
}

void BunInProcessInspectorSession::flushPendingMessages(ScriptExecutionContext& context)
{
    pendingMessageScheduledCount.store(0);

    WTF::Vector<WTF::String, 12> messages;
    {
        Locker<Lock> locker(pendingMessagesLock);
        pendingMessages.swap(messages);
    }

    if (messages.isEmpty())
        return;

    if (!jsOnMessageFunction)
        return;

    auto* global = static_cast<Zig::GlobalObject*>(context.jsGlobalObject());
    auto& vm = global->vm();

    JSFunction* onMessageFn = jsCast<JSFunction*>(jsOnMessageFunction.get());
    MarkedArgumentBuffer arguments;
    arguments.ensureCapacity(messages.size());

    for (auto& m : messages) {
        arguments.append(jsString(vm, m));
    }

    messages.clear();

    JSC::call(global, onMessageFn, arguments, "BunInProcessInspectorSession::flushPendingMessages"_s);
}

class JSBunInProcessInspectorSession final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBunInProcessInspectorSession* create(JSC::VM& vm, JSC::Structure* structure, BunInProcessInspectorSession* session)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSBunInProcessInspectorSession>(vm)) JSBunInProcessInspectorSession(vm, structure, session);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_EXPORT_INFO;

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSBunInProcessInspectorSession, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBunInspectorConnection.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunInspectorConnection = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBunInspectorConnection.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBunInspectorConnection = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    BunInProcessInspectorSession* session() const { return m_session; }

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSBunInProcessInspectorSession*>(cell)->~JSBunInProcessInspectorSession();
    }

    ~JSBunInProcessInspectorSession()
    {
        if (m_session) {
            m_session->disconnect();
            delete m_session;
            m_session = nullptr;
        }
    }

private:
    JSBunInProcessInspectorSession(JSC::VM& vm, JSC::Structure* structure, BunInProcessInspectorSession* session)
        : Base(vm, structure)
        , m_session(session)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }

    BunInProcessInspectorSession* m_session { nullptr };
};

const JSC::ClassInfo JSBunInProcessInspectorSession::s_info = { "BunInProcessInspectorSession"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunInProcessInspectorSession) };

JSC_DECLARE_HOST_FUNCTION(jsBunInspectorCreateSession);
JSC_DECLARE_HOST_FUNCTION(jsBunInspectorSessionSend);
JSC_DECLARE_HOST_FUNCTION(jsBunInspectorSessionDisconnect);

JSC_DEFINE_HOST_FUNCTION(jsBunInspectorCreateSession, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (!thisGlobalObject)
        return JSValue::encode(jsUndefined());

    if (callFrame->argumentCount() < 2)
        return JSValue::encode(jsUndefined());

    bool unrefEventLoop = callFrame->argument(0).toBoolean(globalObject);
    JSFunction* onMessageFn = jsDynamicCast<JSFunction*>(callFrame->argument(1).toObject(globalObject));
    if (!onMessageFn)
        return JSValue::encode(jsUndefined());

    ScriptExecutionContext* targetContext = thisGlobalObject->scriptExecutionContext();
    if (!targetContext)
        return JSValue::encode(jsUndefined());

    // Ensure inspector exists, but don't clobber if already present.
    auto* targetGlobal = targetContext->jsGlobalObject();
    if (!targetGlobal->m_inspectorController || !targetGlobal->m_inspectorDebuggable) {
        Bun__ensureDebugger(targetContext->identifier(), false);
    }

    auto& vm = JSC::getVM(globalObject);

    bool shouldRefEventLoop = !unrefEventLoop;
    auto* session = new BunInProcessInspectorSession(*targetContext, targetContext->jsGlobalObject(), shouldRefEventLoop, onMessageFn);
    session->connect();

    return JSValue::encode(JSBunInProcessInspectorSession::create(vm, JSBunInProcessInspectorSession::createStructure(vm, globalObject, globalObject->objectPrototype()), session));
}

JSC_DEFINE_HOST_FUNCTION(jsBunInspectorSessionSend, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* jsSession = jsDynamicCast<JSBunInProcessInspectorSession*>(callFrame->thisValue());
    if (!jsSession)
        return JSValue::encode(jsUndefined());

    auto* session = jsSession->session();
    if (!session)
        return JSValue::encode(jsUndefined());

    auto message = callFrame->uncheckedArgument(0);

    if (message.isString()) {
        session->dispatchMessageFromSession(message.toWTFString(globalObject).isolatedCopy());
    } else if (message.isCell() && message.asCell()->inherits<JSArray>()) {
        auto* array = jsCast<JSArray*>(message.asCell());
        JSC::forEachInArrayLike(globalObject, array, [&](JSC::JSValue value) -> bool {
            session->dispatchMessageFromSession(value.toWTFString(globalObject).isolatedCopy());
            return true;
        });
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsBunInspectorSessionDisconnect, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    UNUSED_PARAM(globalObject);
    UNUSED_PARAM(callFrame);

    auto* jsSession = jsDynamicCast<JSBunInProcessInspectorSession*>(callFrame->thisValue());
    if (!jsSession)
        return JSValue::encode(jsUndefined());

    auto* session = jsSession->session();
    if (!session)
        return JSValue::encode(jsUndefined());

    session->disconnect();
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
