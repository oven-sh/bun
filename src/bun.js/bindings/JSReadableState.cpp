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

    m_highWaterMark = objectMode ? 16 : 16 * 1024;  // default value
    if (options != nullptr) {
        int64_t customHightWaterMark = getHighWaterMark(vm, globalObject, isDuplex, options);
        if (customHightWaterMark >= 0)
            m_highWaterMark = customHightWaterMark;
    }

    putDirect(vm, JSC::Identifier::fromString(vm, "buffer"_s), JSBufferList::create(
        vm, globalObject, reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferListStructure()));
    putDirect(vm, JSC::Identifier::fromString(vm, "pipes"_s), JSC::constructEmptyArray(globalObject, nullptr, 0));

    if (options == nullptr) {
        m_emitClose = false;
        m_autoDestroy = false;
    } else {
        JSC::JSValue emitCloseVal = options->getDirect(vm, JSC::Identifier::fromString(vm, "emitClose"_s));
        m_emitClose = !emitCloseVal.isBoolean() || emitCloseVal.toBoolean(globalObject);
        // Has it been destroyed.
        JSC::JSValue autoDestroyVal = options->getDirect(vm, JSC::Identifier::fromString(vm, "autoDestroy"_s));
        m_autoDestroy = !autoDestroyVal.isBoolean() || autoDestroyVal.toBoolean(globalObject);
    }

    // Indicates whether the stream has finished destroying.
    putDirect(vm, JSC::Identifier::fromString(vm, "errored"_s), JSC::jsNull());

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

#define JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(NAME) \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME); \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)) \
    { \
        auto& vm = JSC::getVM(lexicalGlobalObject); \
        auto throwScope = DECLARE_THROW_SCOPE(vm); \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue)); \
        if (!state) { \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined())); \
        } \
        if (state->m_##NAME == 0) \
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNull())); \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsBoolean(state->m_##NAME > 0))); \
    } \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME); \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    { \
        auto& vm = JSC::getVM(lexicalGlobalObject); \
        auto throwScope = DECLARE_THROW_SCOPE(vm); \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue)); \
        if (!state) { \
            RETURN_IF_EXCEPTION(throwScope, false); \
        } \
        auto value = JSC::JSValue::decode(encodedValue); \
        state->m_##NAME = value.isNull() ? 0 : value.toBoolean(lexicalGlobalObject) ? 1 : -1; \
        RELEASE_AND_RETURN(throwScope, true); \
    }

JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(paused)
JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(flowing)

#undef JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER

#define JSReadableState_GETTER_SETTER(NAME, TYPE)                                                                                      \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME); \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)) \
    {                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject); \
        auto throwScope = DECLARE_THROW_SCOPE(vm); \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue)); \
        if (!state) { \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined())); \
        } \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::js##TYPE(state->m_##NAME))); \
    } \
    \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME); \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    { \
        auto& vm = JSC::getVM(lexicalGlobalObject); \
        auto throwScope = DECLARE_THROW_SCOPE(vm); \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue)); \
        if (!state) { \
            RETURN_IF_EXCEPTION(throwScope, false); \
        } \
        state->m_##NAME = JSC::JSValue::decode(encodedValue).to##TYPE(lexicalGlobalObject); \
        RETURN_IF_EXCEPTION(throwScope, false); \
        RELEASE_AND_RETURN(throwScope, true); \
    }

#define JSReadableState_BOOLEAN_GETTER_SETTER(NAME)       \
    JSReadableState_GETTER_SETTER(NAME, Boolean)

#define JSReadableState_NUMBER_GETTER_SETTER(NAME)        \
    JSReadableState_GETTER_SETTER(NAME, Number)

JSReadableState_BOOLEAN_GETTER_SETTER(ended)
JSReadableState_BOOLEAN_GETTER_SETTER(endEmitted)
JSReadableState_BOOLEAN_GETTER_SETTER(reading)
JSReadableState_BOOLEAN_GETTER_SETTER(constructed)
JSReadableState_BOOLEAN_GETTER_SETTER(sync)
JSReadableState_BOOLEAN_GETTER_SETTER(needReadable)
JSReadableState_BOOLEAN_GETTER_SETTER(emittedReadable)
JSReadableState_BOOLEAN_GETTER_SETTER(readableListening)
JSReadableState_BOOLEAN_GETTER_SETTER(resumeScheduled)
JSReadableState_BOOLEAN_GETTER_SETTER(errorEmitted)
JSReadableState_BOOLEAN_GETTER_SETTER(emitClose)
JSReadableState_BOOLEAN_GETTER_SETTER(autoDestroy)
JSReadableState_BOOLEAN_GETTER_SETTER(destroyed)
JSReadableState_BOOLEAN_GETTER_SETTER(closed)
JSReadableState_BOOLEAN_GETTER_SETTER(closeEmitted)
JSReadableState_BOOLEAN_GETTER_SETTER(multiAwaitDrain)
JSReadableState_BOOLEAN_GETTER_SETTER(readingMore)
JSReadableState_BOOLEAN_GETTER_SETTER(dataEmitted)

JSReadableState_NUMBER_GETTER_SETTER(length)
JSReadableState_NUMBER_GETTER_SETTER(highWaterMark)

#undef JSReadableState_NUMBER_GETTER_SETTER
#undef JSReadableState_BOOLEAN_GETTER_SETTER
#undef JSReadableState_GETTER_SETTER

#define JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(NAME) \
    { #NAME ""_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableState_##NAME, setJSReadableState_##NAME } }

/* Hash table for prototype */
static const HashTableValue JSReadableStatePrototypeTableValues[]
    = {
          { "pipesCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableState_pipesCount, 0 } },
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(paused),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(flowing),
          
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(ended),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(endEmitted),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(reading),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(constructed),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(sync),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(needReadable),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(emittedReadable),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(readableListening),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(resumeScheduled),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(errorEmitted),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(emitClose),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(autoDestroy),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(destroyed),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(closed),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(closeEmitted),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(multiAwaitDrain),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(readingMore),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(dataEmitted),

          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(length),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(highWaterMark),
      };

#undef JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE

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
