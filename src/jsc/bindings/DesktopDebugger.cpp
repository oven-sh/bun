// The domain `Debugger` of src/desktop/devtools.
#include "root.h"
#include "BunCompiledModules.h"
#include "BunProcess.h"
#include "JSCommonJSModule.h"
#include "PathInlines.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/Debugger.h>
#include <JavaScriptCore/DebuggerCallFrame.h>
#include <JavaScriptCore/InjectedScriptHost.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSInjectedScriptHost.h>
#include <JavaScriptCore/JSJavaScriptCallFrame.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/VMInlines.h>
#include <wtf/FileSystem.h>

namespace Bun {
using namespace JSC;

struct ParsedScript {
    uint32_t id;
    uint32_t start[2];
    uint32_t end[2];
    uint32_t length;
    bool isModule;
    bool hasFailed;
    BunString url;
    BunString directive;
    BunString map;
};

struct DebuggerClient {
    void* context;
    void (*parsed)(void*, JSGlobalObject*, const ParsedScript*);
    // It returns when the page may go on.
    void (*paused)(void*, JSGlobalObject*, EncodedJSValue thrown, uint32_t breakpoint);
};

enum class Command : uint8_t {
    Activate,
    Deactivate,
    Pause,
    Resume,
    StepInto,
    StepOver,
    StepOut,
    SkipPauses,
    TakePauses,
    IgnoreExceptions,
    PauseOnUncaught,
    PauseOnAll,
};

class DesktopDebugger final : public Debugger {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DesktopDebugger);

public:
    DesktopDebugger(VM& vm)
        : Debugger(vm)
    {
        setPauseOnDebuggerStatementsBreakpoint(Breakpoint::create(noBreakpointID));
        setBlackboxBreakpointEvaluations(true);
    }

    void follow(JSGlobalObject* realm, DebuggerClient client)
    {
        m_client = client;
        m_realms.append(Weak<JSGlobalObject>(realm));
        attach(realm);
    }

    void leaveAll()
    {
        clearBreakpoints();
        clearBlackbox();
        continueProgram();
        for (auto& realm : std::exchange(m_realms, {})) {
            if (realm && isAttached(realm.get()))
                detach(realm.get(), TerminatingDebuggingSession);
        }
        scripts.clear();
        breakpoints.clear();
    }

    // Those of scripts that it knows, innermost first.
    Vector<Ref<DebuggerCallFrame>> frames()
    {
        Vector<Ref<DebuggerCallFrame>> all;
        for (RefPtr frame = isPaused() && !m_realms.isEmpty() ? &currentDebuggerCallFrame() : nullptr; frame && frame->isValid(); frame = frame->callerFrame()) {
            if (frame->sourceID() != noSourceID && scripts.contains(frame->sourceID()))
                all.append(*frame);
        }
        return all;
    }

    SourceProvider* script(SourceID id) const { return scripts.isValidKey(id) ? scripts.get(id) : nullptr; }

    UncheckedKeyHashMap<SourceID, Ref<SourceProvider>> scripts;
    UncheckedKeyHashMap<BreakpointID, BreakpointsVector> breakpoints;

private:
    using Debugger::sourceParsed;

    void sourceParsed(JSGlobalObject* realm, SourceProvider* provider, int errorLine, const String&) final
    {
        String url = provider->sourceURL();
        if (url.startsWith("internal:"_s) || url.startsWith("node:"_s) || !scripts.add(provider->asID(), *provider).isNewEntry)
            return;
        auto source = provider->source();
        uint32_t line = provider->startPosition().m_line.zeroBasedInt(), column = provider->startPosition().m_column.zeroBasedInt();
        uint32_t lines = 0, lastLine = 0;
        for (size_t at = source.find('\n'); at != notFound; at = source.find('\n', at + 1)) {
            lines++;
            lastLine = at + 1;
        }
        String directive = provider->sourceURLDirective(), map = provider->sourceMappingURLDirective();
        ParsedScript script {
            static_cast<uint32_t>(provider->asID()),
            { line, column },
            { line + lines, (lines ? 0 : column) + source.length() - lastLine },
            source.length(),
            provider->isModuleType(),
            errorLine != -1,
            Bun::toString(url),
            Bun::toString(directive),
            Bun::toString(map),
        };
        m_client.parsed(m_client.context, realm, &script);
    }

    void handlePause(JSGlobalObject* realm) final
    {
        if (!frames().isEmpty())
            m_client.paused(m_client.context, realm, JSValue::encode(reasonForPause() == PausedForException ? currentException() : JSValue()), pausingBreakpointID());
    }

    bool isPauseBlockedByAnotherDebugger() const final
    {
        bool isBlocked = false;
        const_cast<DesktopDebugger*>(this)->vm().forEachDebugger([&](Debugger& other) {
            isBlocked |= &other != this && other.isPaused();
        });
        return isBlocked;
    }

    DebuggerClient m_client {};
    Vector<Weak<JSGlobalObject>> m_realms;
};

static EncodedJSValue arrayOf(JSGlobalObject* realm, MarkedArgumentBuffer& all)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    if (all.hasOverflowed()) {
        throwOutOfMemoryError(realm, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(realm, static_cast<ArrayAllocationProfile*>(nullptr), all)));
}

static NEVER_INLINE DesktopDebugger* createDebugger(VM& vm)
{
    JSC_REMOVABLE_DEFINITION(Inspector, createDebugger);
    return new DesktopDebugger(vm);
}

// An app does not keep the inspector by having windows. What takes a `DesktopDebugger` is only reached with one.
extern "C" DesktopDebugger* Bun__Debugger__create(JSGlobalObject* global)
{
    return !isFeatureRemoved(RemovableFeature::Inspector) && isDebuggerAdmitted() ? createDebugger(global->vm()) : nullptr;
}

// `base[name]`, or empty if that would run a script. What a native getter would give counts as `ofNativeGetter`.
static JSValue peekInApp(JSGlobalObject* globalObject, JSValue base, const Identifier& name, JSValue ofNativeGetter = {})
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSObject* object = base.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    while (object) {
        if (object->type() == ProxyObjectType || object->structure()->typeInfo().getOwnPropertySlotIsImpure())
            return {};
        PropertyDescriptor descriptor;
        bool isOwn = object->getOwnPropertyDescriptor(globalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (isOwn)
            return descriptor.isDataDescriptor() ? descriptor.value() : JSC::getCallData(descriptor.getter()).type == CallData::Type::Native ? ofNativeGetter
                                                                                                                                             : JSValue();
        JSValue prototype = object->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        object = prototype.getObject();
    }
    return jsUndefined();
}

// `$peek(() => a, "a", "b")` is `a.b`. It throws if getting or describing that could run a script.
JSC_DEFINE_HOST_FUNCTION(peekAtPath, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = globalObject;
    for (size_t index = 1; value && index < callFrame->argumentCount(); index++) {
        auto name = callFrame->uncheckedArgument(index).toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        value = peekInApp(globalObject, value, name);
        RETURN_IF_EXCEPTION(scope, {});
        if (value && index == 1)
            value = JSC::call(globalObject, callFrame->uncheckedArgument(0), ArgList(), ""_s);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (value && value.isObject() && asObject(value)->type() != ProxyObjectType) {
        auto& names = *vm.propertyNames;
        for (auto& name : { Identifier::fromString(vm, "splice"_s), names.length, names.size, names.name, names.message, names.prototype, names.constructor, names.toString, names.toPrimitiveSymbol }) {
            JSValue member = peekInApp(globalObject, value, name, jsUndefined());
            RETURN_IF_EXCEPTION(scope, {});
            if (member && member.isObject() && name == names.constructor)
                member = peekInApp(globalObject, member, names.name);
            RETURN_IF_EXCEPTION(scope, {});
            if (!member || ((name == names.toString || name == names.toPrimitiveSymbol) && JSC::getCallData(member).type == CallData::Type::JS))
                return throwVMTypeError(globalObject, scope);
        }
    }
    return value ? JSValue::encode(value) : throwVMTypeError(globalObject, scope);
}

JSC_DEFINE_HOST_FUNCTION(evaluateWithAdditions, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (JSObject* commandLineAPI = callFrame->argument(1).getObject()) {
        JSValue cwd = getCachedCwd(globalObject);
        if (!scope.exception()) {
            String directory = cwd.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            JSObject* require = JSCommonJSModule::createBoundRequireFunction(vm, globalObject, FileSystem::pathByAppendingComponent(directory, "[console]"_s));
            RETURN_IF_EXCEPTION(scope, {});
            Bun::putDirectNamed(vm, commandLineAPI, "require"_s, require);
        } else if (!scope.tryClearException())
            return {};
        Bun::putDirectNamed(vm, commandLineAPI, "$peek"_s, JSFunction::create(vm, globalObject, 2, "$peek"_s, peekAtPath, ImplementationVisibility::Private));
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(uncheckedDowncast<Inspector::JSInjectedScriptHost>(callFrame->thisValue())->evaluateWithScopeExtension(globalObject, callFrame)));
}

// With `require`, as in Node.js, and with what honors `throwOnSideEffect`.
void extendCommandLineOfDesktopApp(JSGlobalObject* globalObject, Inspector::InjectedScriptHost& host)
{
    VM& vm = globalObject->vm();
    JSLockHolder locker(vm);
    auto name = "evaluateWithScopeExtension"_s;
    Bun::putDirectNamed(vm, asObject(host.wrapper(globalObject)), name, JSFunction::create(vm, globalObject, 2, name, evaluateWithAdditions, ImplementationVisibility::Private));
}

struct PauseAtFirstFile final : Debugger::Observer {
    void didParseSource(JSGlobalObject* global, SourceID, const Debugger::Script& script) final
    {
        if (!isAbsolutePath(script.url))
            return;
        global->debugger()->schedulePauseAtNextOpportunity();
        global->debugger()->removeObserver(*this, false);
    }
};

static NEVER_INLINE void pauseAtFirstFile(JSC::Debugger& debugger)
{
    JSC_REMOVABLE_DEFINITION(Inspector, pauseAtFirstFile);
    static NeverDestroyed<PauseAtFirstFile> observer;
    debugger.addObserver(observer.get());
}

// With the debugger of node:inspector.
extern "C" void Bun__Debugger__pauseApp(JSGlobalObject* global)
{
    if (auto* debugger = global->debugger())
        pauseAtFirstFile(*debugger);
}

// It can be on the stack, below the condition of a breakpoint.
extern "C" NEVER_INLINE void Bun__Debugger__destroy(DesktopDebugger* debugger)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__destroy);
    debugger->leaveAll();
    debugger->vm().whenIdle([debugger] { delete debugger; });
}

// Whether no other debugger was first.
extern "C" NEVER_INLINE bool Bun__Debugger__follow(DesktopDebugger* debugger, JSGlobalObject* realm, DebuggerClient client)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__follow);
    if (!realm->debugger())
        debugger->follow(realm, client);
    return debugger->isAttached(realm);
}

extern "C" NEVER_INLINE void Bun__Debugger__leaveAll(DesktopDebugger* debugger)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__leaveAll);
    debugger->leaveAll();
}

extern "C" NEVER_INLINE void Bun__Debugger__command(DesktopDebugger* debugger, Command command)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__command);
    switch (command) {
    case Command::Activate:
        return debugger->activateBreakpoints();
    case Command::Deactivate:
        return debugger->deactivateBreakpoints();
    case Command::Pause:
        return debugger->schedulePauseAtNextOpportunity();
    case Command::Resume:
        return debugger->continueProgram();
    case Command::StepInto:
        return debugger->stepIntoStatement();
    case Command::StepOver:
        return debugger->stepOverStatement();
    case Command::StepOut:
        return debugger->stepOutOfFunction();
    case Command::SkipPauses:
    case Command::TakePauses:
        return debugger->setSuppressAllPauses(command == Command::SkipPauses);
    case Command::IgnoreExceptions:
    case Command::PauseOnUncaught:
    case Command::PauseOnAll:
        debugger->setPauseOnUncaughtExceptionsBreakpoint(command == Command::PauseOnUncaught ? RefPtr { Breakpoint::create(noBreakpointID) } : nullptr);
        return debugger->setPauseOnAllExceptionsBreakpoint(command == Command::PauseOnAll ? RefPtr { Breakpoint::create(noBreakpointID) } : nullptr);
    }
}

extern "C" NEVER_INLINE bool Bun__Debugger__source(DesktopDebugger* debugger, uint32_t script, BunString* source)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__source);
    auto* provider = debugger->script(script);
    if (provider)
        *source = Bun::toStringRef(provider->source().toString()).leak();
    return provider;
}

// `place` is the script, the line and the column. It is moved to where a pause is possible.
extern "C" NEVER_INLINE bool Bun__Debugger__setBreakpoint(DesktopDebugger* debugger, uint32_t id, const BunString* condition, uint32_t* place)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__setBreakpoint);
    auto* provider = debugger->script(place[0]);
    auto breakpoint = Breakpoint::create(id, condition->toWTFString());
    if (!provider || !breakpoint->link(place[0], place[1], place[2]) || !debugger->resolveBreakpoint(breakpoint, provider) || !debugger->setBreakpoint(breakpoint))
        return false;
    place[1] = breakpoint->lineNumber();
    place[2] = breakpoint->columnNumber();
    debugger->breakpoints.add(id, BreakpointsVector()).iterator->value.append(WTF::move(breakpoint));
    return true;
}

extern "C" NEVER_INLINE void Bun__Debugger__removeBreakpoint(DesktopDebugger* debugger, uint32_t id)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__removeBreakpoint);
    for (auto& breakpoint : debugger->breakpoints.take(id))
        debugger->removeBreakpoint(breakpoint);
}

// The line and the column of each.
extern "C" NEVER_INLINE EncodedJSValue Bun__Debugger__possibleBreakpoints(DesktopDebugger* debugger, JSGlobalObject* global, uint32_t script, const uint32_t* range)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__possibleBreakpoints);
    MarkedArgumentBuffer all;
    if (auto* provider = debugger->script(script)) {
        debugger->forEachBreakpointLocation(script, provider, clampTo<int>(range[0]), clampTo<int>(range[1]), clampTo<int>(range[2]), clampTo<int>(range[3]), [&](int line, int column) {
            all.append(jsNumber(line));
            all.append(jsNumber(column));
        });
    }
    return arrayOf(global, all);
}

// Steps go through it.
extern "C" NEVER_INLINE void Bun__Debugger__ignore(DesktopDebugger* debugger, uint32_t script, bool isIgnored)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__ignore);
    Debugger::BlackboxConfiguration ranges;
    auto last = OrdinalNumber::fromZeroBasedInt(std::numeric_limits<int>::max() - 1);
    if (isIgnored)
        ranges.add(Debugger::BlackboxRange { TextPosition(), TextPosition(last, last) }, Debugger::BlackboxFlag::Defer);
    debugger->setBlackboxConfiguration(script, WTF::move(ranges));
}

static ASCIILiteral kindOf(int32_t type, bool isLocal)
{
    using Frame = Inspector::JSJavaScriptCallFrame;
    switch (type) {
    case Frame::CATCH_SCOPE:
        return "catch"_s;
    case Frame::WITH_SCOPE:
        return "with"_s;
    case Frame::GLOBAL_SCOPE:
        return "global"_s;
    case Frame::GLOBAL_LEXICAL_ENVIRONMENT_SCOPE:
        return "script"_s;
    case Frame::NESTED_LEXICAL_SCOPE:
        return "block"_s;
    default:
        return isLocal ? "local"_s : "closure"_s;
    }
}

// The function, the script, the line, the column, `this` and the scopes of each frame: the kind, the name and the objects, of which a function has several.
extern "C" NEVER_INLINE EncodedJSValue Bun__Debugger__frames(DesktopDebugger* debugger, JSGlobalObject* global)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__frames);
    VM& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer all;
    for (auto& frame : debugger->frames()) {
        bool isFunction = frame->type(vm) == DebuggerCallFrame::FunctionType;
        auto* wrapper = uncheckedDowncast<Inspector::JSJavaScriptCallFrame>(toJS(global, global, Inspector::JavaScriptCallFrame::create(frame.copyRef()).ptr()));
        JSValue objects = wrapper->scopeChain(global);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue descriptions = wrapper->scopeDescriptions(global);
        RETURN_IF_EXCEPTION(scope, {});
        String last;
        JSArray* parts = nullptr;
        bool isLocal = isFunction;
        MarkedArgumentBuffer scopes;
        for (unsigned index = 0; objects.isObject() && index < asArray(objects)->length(); index++) {
            auto member = [&](ASCIILiteral name) { return asObject(asArray(descriptions)->getIndexQuickly(index))->getDirect(vm, Identifier::fromString(vm, name)); };
            int32_t type = member("type"_s).asInt32();
            bool isOfFunction = type == Inspector::JSJavaScriptCallFrame::CLOSURE_SCOPE || type == Inspector::JSJavaScriptCallFrame::FUNCTION_NAME_SCOPE;
            String place = isOfFunction ? JSONStringify(global, member("location"_s), 0u) : String();
            RETURN_IF_EXCEPTION(scope, {});
            if (!isOfFunction || place != last) {
                parts = constructEmptyArray(global, nullptr);
                RETURN_IF_EXCEPTION(scope, {});
                for (JSValue part : { JSValue(jsString(vm, String(kindOf(type, isLocal)))), member("name"_s), JSValue(parts) })
                    scopes.append(part);
                isLocal &= !isOfFunction;
            }
            parts->push(global, asArray(objects)->getIndexQuickly(index));
            RETURN_IF_EXCEPTION(scope, {});
            last = place;
        }
        JSValue chain = JSValue::decode(arrayOf(global, scopes));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue receiver = frame->thisValue(vm);
        RETURN_IF_EXCEPTION(scope, {});
        String name = isFunction ? frame->functionName(vm) : String();
        for (JSValue part : { JSValue(jsString(vm, name.isNull() ? emptyString() : name)), jsNumber(static_cast<uint32_t>(frame->sourceID())), jsNumber(frame->line()), jsNumber(frame->column()), receiver, chain })
            all.append(part);
    }
    RELEASE_AND_RETURN(scope, arrayOf(global, all));
}

extern "C" NEVER_INLINE JSGlobalObject* Bun__Debugger__realmOfFrame(DesktopDebugger* debugger, uint32_t index)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__realmOfFrame);
    auto frames = debugger->frames();
    return index < frames.size() ? frames[index]->globalObject(debugger->vm()) : nullptr;
}

extern "C" NEVER_INLINE EncodedJSValue Bun__Debugger__evaluate(DesktopDebugger* debugger, JSGlobalObject* realm, uint32_t index, const BunString* source, EncodedJSValue helpers)
{
    JSC_REMOVABLE_DEFINITION(Inspector, Bun__Debugger__evaluate);
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    auto frames = debugger->frames();
    if (index >= frames.size())
        return JSValue::encode(jsUndefined());
    NakedPtr<JSC::Exception> exception;
    JSValue result = frames[index]->evaluateWithScopeExtension(realm->vm(), source->toWTFString(), JSValue::decode(helpers).getObject(), exception);
    if (exception) {
        throwException(realm, scope, exception.get());
        return {};
    }
    return JSValue::encode(result);
}

}
