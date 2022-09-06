#include "JSReadableState.h"
#include "JSBufferList.h"
#include "JSBuffer.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_pipesCount);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_paused);
static JSC_DECLARE_CUSTOM_GETTER(setJSReadableState_paused);

int64_t getHighWaterMark(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isDuplex, JSObject* options)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue highWaterMarkVal = options->getDirect(vm, JSC::Identifier::fromString(vm, "highWaterMark"_s));
    if (isDuplex && (highWaterMarkVal.isUndefined() || highWaterMarkVal.isNull())) {
        highWaterMarkVal = options->getDirect(vm, JSC::Identifier::fromString(vm, "readableObjectMode"_s));
    }
    if (!highWaterMarkVal.isNull() && !highWaterMarkVal.isUndefined()) {
        double customHightWaterMark = highWaterMarkVal.toNumber(globalObject);
        RETURN_IF_EXCEPTION(throwScope, -1);
        if (customHightWaterMark < 0)
          return -1;
        return floor(customHightWaterMark);
    }

    return -1;
}

void JSReadableState::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isDuplex, JSObject* options)
{
    Base::finishCreation(vm);

    bool objectMode = false;
    auto objectModeIdent = JSC::Identifier::fromString(vm, "objectMode"_s);
    if (options != nullptr) {
        JSC::JSValue objectModeVal = options->getDirect(vm, objectModeIdent);
        if (isDuplex && !objectModeVal) {
            objectModeVal = options->getDirect(vm, JSC::Identifier::fromString(vm, "readableObjectMode"_s));
        }
        if (objectModeVal)
            objectMode = objectModeVal.toBoolean(globalObject);
    }
    putDirect(vm, WTFMove(objectModeIdent), JSC::jsBoolean(objectMode));

    int64_t highWaterMark = objectMode ? 16 : 16 * 1024;  // default value
    if (options != nullptr) {
        int64_t customHightWaterMark = getHighWaterMark(vm, globalObject, isDuplex, options);
        if (customHightWaterMark >= 0)
            highWaterMark = customHightWaterMark;
    }
    putDirect(vm, JSC::Identifier::fromString(vm, "highWaterMark"_s), JSC::jsNumber(highWaterMark));

    putDirect(vm, JSC::Identifier::fromString(vm, "buffer"_s), JSBufferList::create(
        vm, globalObject, reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferListStructure()));
    putDirect(vm, JSC::Identifier::fromString(vm, "length"_s), JSC::jsNumber(0));
    putDirect(vm, JSC::Identifier::fromString(vm, "pipes"_s), JSC::constructEmptyArray(globalObject, nullptr, 0));
    putDirect(vm, JSC::Identifier::fromString(vm, "flowing"_s), JSC::jsNull());
    putDirect(vm, JSC::Identifier::fromString(vm, "ended"_s), JSC::jsBoolean(false));
    putDirect(vm, JSC::Identifier::fromString(vm, "endEmitted"_s), JSC::jsBoolean(false));
    // Stream is still being constructed and cannot be
    // destroyed until construction finished or failed.
    // Async construction is opt in, therefore we start as
    // constructed.
    putDirect(vm, JSC::Identifier::fromString(vm, "reading"_s), JSC::jsBoolean(false));

    // A flag to be able to tell if the event 'readable'/'data' is emitted
    // immediately, or on a later tick.  We set this to true at first, because
    // any actions that shouldn't happen until "later" should generally also
    // not happen before the first read call.
    putDirect(vm, JSC::Identifier::fromString(vm, "constructed"_s), JSC::jsBoolean(true));

    // Whenever we return null, then we set a flag to say
    // that we're awaiting a 'readable' event emission.
    putDirect(vm, JSC::Identifier::fromString(vm, "sync"_s), JSC::jsBoolean(true));

    putDirect(vm, JSC::Identifier::fromString(vm, "needReadable"_s), JSC::jsBoolean(false));
    putDirect(vm, JSC::Identifier::fromString(vm, "emittedReadable"_s), JSC::jsBoolean(false));
    putDirect(vm, JSC::Identifier::fromString(vm, "readableListening"_s), JSC::jsBoolean(false));
    putDirect(vm, JSC::Identifier::fromString(vm, "resumeScheduled"_s), JSC::jsBoolean(false));

    // Should close be emitted on destroy. Defaults to true.
    putDirect(vm, JSC::Identifier::fromString(vm, "errorEmitted"_s), JSC::jsBoolean(false));

    if (options == nullptr) {
        // Should .destroy() be called after 'end' (and potentially 'finish').
        putDirect(vm, JSC::Identifier::fromString(vm, "emitClose"_s), JSC::jsBoolean(false));
        // Has it been destroyed.
        putDirect(vm, JSC::Identifier::fromString(vm, "autoDestroy"_s), JSC::jsBoolean(false));
    } else {
        // Should .destroy() be called after 'end' (and potentially 'finish').
        auto emitCloseIdent = JSC::Identifier::fromString(vm, "emitClose"_s);
        JSC::JSValue emitCloseVal = options->getDirect(vm, emitCloseIdent);
        putDirect(vm, WTFMove(emitCloseIdent), JSC::jsBoolean(!emitCloseVal.isBoolean() || emitCloseVal.toBoolean(globalObject)));
        // Has it been destroyed.
        auto autoDestroyIdent = JSC::Identifier::fromString(vm, "autoDestroy"_s);
        JSC::JSValue autoDestroyVal = options->getDirect(vm, autoDestroyIdent);
        putDirect(vm, WTFMove(autoDestroyIdent), JSC::jsBoolean(!autoDestroyVal.isBoolean() || autoDestroyVal.toBoolean(globalObject)));
    }

    // Indicates whether the stream has errored. When true no further
    // _read calls, 'data' or 'readable' events should occur. This is needed
    // since when autoDestroy is disabled we need a way to tell whether the
    // stream has failed.
    putDirect(vm, JSC::Identifier::fromString(vm, "destroyed"_s), JSC::jsBoolean(false));

    // Indicates whether the stream has finished destroying.
    putDirect(vm, JSC::Identifier::fromString(vm, "errored"_s), JSC::jsNull());

    // True if close has been emitted or would have been emitted
    // depending on emitClose.
    putDirect(vm, JSC::Identifier::fromString(vm, "closed"_s), JSC::jsBoolean(false));

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    putDirect(vm, JSC::Identifier::fromString(vm, "closeEmitted"_s), JSC::jsBoolean(false));

    // Ref the piped dest which we need a drain event on it
    // type: null | Writable | Set<Writable>.
    auto defaultEncodingIdent = JSC::Identifier::fromString(vm, "defaultEncoding"_s);
    if (options == nullptr) {
        putDirect(vm, WTFMove(defaultEncodingIdent), JSC::jsString(vm, WTF::String("utf8"_s)));
    } else {
        JSC::JSValue defaultEncodingVal = getDirect(vm, defaultEncodingIdent);
        if (defaultEncodingVal) {
            putDirect(vm, WTFMove(defaultEncodingIdent), defaultEncodingVal);
        } else {
            putDirect(vm, WTFMove(defaultEncodingIdent), JSC::jsString(vm, WTF::String("utf8"_s)));
        }
    }

    putDirect(vm, JSC::Identifier::fromString(vm, "awaitDrainWriters"_s), JSC::jsNull());
    // If true, a maybeReadMore has been scheduled.
    putDirect(vm, JSC::Identifier::fromString(vm, "multiAwaitDrain"_s), JSC::jsBoolean(false));

    putDirect(vm, JSC::Identifier::fromString(vm, "readingMore"_s), JSC::jsBoolean(false));
    putDirect(vm, JSC::Identifier::fromString(vm, "dataEmitted"_s), JSC::jsBoolean(false));

    auto decoderIdent = JSC::Identifier::fromString(vm, "decoder"_s);
    auto encodingIdent = JSC::Identifier::fromString(vm, "encoding"_s);
    if (options == nullptr) {
        putDirect(vm, WTFMove(decoderIdent), JSC::jsNull());
        putDirect(vm, WTFMove(encodingIdent), JSC::jsNull());
    } else {
        JSC::JSValue encodingVal = options->getDirect(vm, encodingIdent);
        if (encodingVal) {
            auto constructor = reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSStringDecoder();
            auto constructData = JSC::getConstructData(constructor);
            MarkedArgumentBuffer args;
            args.append(encodingVal);
            JSObject* decoder = JSC::construct(globalObject, constructor, constructData, args);
            putDirect(vm, WTFMove(decoderIdent), decoder);
            putDirect(vm, WTFMove(encodingIdent), encodingVal);
        } else {
            putDirect(vm, WTFMove(decoderIdent), JSC::jsNull());
            putDirect(vm, WTFMove(encodingIdent), JSC::jsNull());
        }
    }
}

const JSC::ClassInfo JSReadableState::s_info = { "ReadableState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableState) };

JSC::GCClient::IsoSubspace* JSReadableState::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableState, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableState = WTFMove(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableState = WTFMove(space); });
}

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStatePrototype, JSReadableStatePrototype::Base);

JSC_DEFINE_CUSTOM_GETTER(jsReadableState_pipesCount, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSObject* thisObject = JSC::jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    JSC::JSValue pipesVal = thisObject->getDirect(vm, JSC::Identifier::fromString(vm, "pipes"_s));
    if (!pipesVal) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    JSArray* pipes = JSC::jsDynamicCast<JSArray*>(pipesVal);
    if (!pipes) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(pipes->length())));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableState_paused, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));
    if (!state) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    if (state->m_paused == 0)
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNull()));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsBoolean(state->m_paused > 0)));
}

JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_paused, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));
    if (!state) {
        RETURN_IF_EXCEPTION(throwScope, false);
    }
    state->m_paused = JSC::JSValue::decode(encodedValue).toBoolean(lexicalGlobalObject) ? 1 : -1;
    RELEASE_AND_RETURN(throwScope, true);
}

/* Hash table for prototype */
static const HashTableValue JSReadableStatePrototypeTableValues[]
    = {
          { "pipesCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableState_pipesCount, 0 } },
          { "paused"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableState_paused, setJSReadableState_paused } },
      };

void JSReadableStatePrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableState::info(), JSReadableStatePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSReadableStatePrototype::s_info = { "ReadableState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStatePrototype) };

void JSReadableStateConstructor::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStatePrototype* prototype)
{
    Base::finishCreation(vm, 0, "ReadableState"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSReadableStateConstructor* JSReadableStateConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStatePrototype* prototype) {
    JSReadableStateConstructor* ptr = new (NotNull, JSC::allocateCell<JSReadableStateConstructor>(vm)) JSReadableStateConstructor(vm, structure, construct);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

JSC::EncodedJSValue JSReadableStateConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 3) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }
    JSValue optionsVal = callFrame->uncheckedArgument(0);
    JSValue streamVal = callFrame->uncheckedArgument(1);
    JSValue isDuplexVal = callFrame->uncheckedArgument(2);

    bool isDuplex;
    if (!isDuplexVal.isBoolean()) {
        // change this to `stream instanceof Duplex` after native Duplex is implemented.
        JSC::throwTypeError(lexicalGlobalObject, throwScope, "isDuplex should be boolean"_s);
        return JSValue::encode(jsUndefined());
    }
    isDuplex = isDuplexVal.toBoolean(lexicalGlobalObject);
    JSObject* options = nullptr;
    if (optionsVal.toBoolean(lexicalGlobalObject) && optionsVal.isObject()) {
        options = optionsVal.toObject(lexicalGlobalObject);
    }

    JSReadableState* stringDecoder = JSReadableState::create(
        vm, lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSReadableStateStructure(), isDuplex, options);
    return JSC::JSValue::encode(stringDecoder);
}

void JSReadableStateConstructor::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStatePrototype* prototype)
{
}

const ClassInfo JSReadableStateConstructor::s_info = { "ReadableState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStateConstructor) };

} // namespace Zig
