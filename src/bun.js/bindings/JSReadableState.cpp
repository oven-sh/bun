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
#include "BunClientData.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_pipesCount);

int64_t getHighWaterMark(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isDuplex, JSObject* options)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // We must use getIfPropertyExists because:
    // - it might be a getter
    // - it might be from a super class
    auto* clientData = WebCore::clientData(vm);
    if (JSValue highWaterMarkVal = options->getIfPropertyExists(globalObject, clientData->builtinNames().highWaterMarkPublicName())) {
        if (isDuplex && (highWaterMarkVal.isUndefined() || highWaterMarkVal.isNull())) {
            highWaterMarkVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "readableObjectMode"_s));
        }

        if (highWaterMarkVal && highWaterMarkVal.isNumber()) {
            return highWaterMarkVal.toInt32(globalObject);
        }
    }

    return -1;
}

void JSReadableState::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isDuplex, JSObject* options)
{
    Base::finishCreation(vm);

    if (options != nullptr) {
        JSC::JSValue objectModeVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "objectMode"_s));
        if (isDuplex && !objectModeVal) {
            objectModeVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "readableObjectMode"_s));
        }
        if (objectModeVal && objectModeVal.toBoolean(globalObject))
            setBool(JSReadableState::Mask::objectMode, true);
    }

    m_highWaterMark = getBool(
                          JSReadableState::Mask::objectMode)
        ? 16
        : 16 * 1024; // default value

    if (options != nullptr) {
        int64_t customHightWaterMark = getHighWaterMark(vm, globalObject, isDuplex, options);
        if (customHightWaterMark >= 0)
            m_highWaterMark = customHightWaterMark;
    }

    m_buffer.set(vm, this, JSBufferList::create(vm, globalObject, reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferListStructure()));
    m_pipes.set(vm, this, JSC::constructEmptyArray(globalObject, nullptr, 0));

    if (options != nullptr) {
        JSC::JSValue emitCloseVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "emitClose"_s));
        if (!emitCloseVal || emitCloseVal.toBoolean(globalObject))
            setBool(JSReadableState::Mask::emitClose, true);
        // Has it been destroyed.
        JSC::JSValue autoDestroyVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "autoDestroy"_s));
        if (!autoDestroyVal || autoDestroyVal.toBoolean(globalObject))
            setBool(JSReadableState::Mask::autoDestroy, true);
    } else {
        setBool(JSReadableState::Mask::emitClose, true);
        setBool(JSReadableState::Mask::autoDestroy, true);
    }

    // Indicates whether the stream has finished destroying.
    m_errored.set(vm, this, JSC::jsNull());

    // Ref the piped dest which we need a drain event on it
    // type: null | Writable | Set<Writable>.
    if (options == nullptr) {
        m_defaultEncoding.set(vm, this, JSC::jsString(vm, WTF::String("utf8"_s)));
    } else {
        if (JSC::JSValue defaultEncodingVal = getIfPropertyExists(globalObject, PropertyName(JSC::Identifier::fromString(vm, "defaultEncoding"_s)))) {
            m_defaultEncoding.set(vm, this, defaultEncodingVal);
        } else {
            m_defaultEncoding.set(vm, this, JSC::jsString(vm, WTF::String("utf8"_s)));
        }
    }

    m_awaitDrainWriters.set(vm, this, JSC::jsNull());
    JSValue decodeValue = JSC::jsNull();
    JSValue encodingValue = JSC::jsNull();

    if (options != nullptr) {
        JSC::JSValue encodingVal = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "encoding"_s));
        if (encodingVal && encodingVal.isString()) {
            auto constructor = reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSStringDecoder();
            auto constructData = JSC::getConstructData(constructor);
            MarkedArgumentBuffer args;
            args.append(encodingVal);
            JSObject* decoder = JSC::construct(globalObject, constructor, constructData, args);
            decodeValue = decoder;
            encodingValue = encodingVal;
        }
    }

    m_decoder.set(vm, this, decodeValue);
    m_encoding.set(vm, this, encodingValue);

    // ReadableState.constructed is set to false during construction when a _construct method is implemented
    // this is here so that the ReadableState behavior tracks the behavior in node, and that calling Readable.read
    // will work when we return early from construct because there is no Readable._construct implemented
    // See: https://github.com/nodejs/node/blob/main/lib/internal/streams/readable.js
    setBool(JSReadableState::Mask::constructed, true);
}

const JSC::ClassInfo JSReadableState::s_info = { "ReadableState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableState) };

JSC::GCClient::IsoSubspace* JSReadableState::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableState, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableState = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableState = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSReadableState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSReadableState* state = jsCast<JSReadableState*>(cell);
    ASSERT_GC_OBJECT_INHERITS(state, info());
    Base::visitChildren(state, visitor);
    visitor.append(state->m_buffer);
    visitor.append(state->m_pipes);
    visitor.append(state->m_errored);
    visitor.append(state->m_defaultEncoding);
    visitor.append(state->m_awaitDrainWriters);
    visitor.append(state->m_decoder);
    visitor.append(state->m_encoding);
}
DEFINE_VISIT_CHILDREN(JSReadableState);

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStatePrototype, JSReadableStatePrototype::Base);

JSC_DEFINE_CUSTOM_GETTER(jsReadableState_pipesCount, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));
    if (!state) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    JSArray* pipes = JSC::jsDynamicCast<JSArray*>(state->m_pipes.get());
    if (!pipes) {
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(pipes->length())));
}

#define JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(NAME)                                                                                                                       \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME);                                                                                                                      \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))                                 \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));                                                                                             \
        }                                                                                                                                                                          \
        if (state->m_##NAME == 0)                                                                                                                                                  \
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNull()));                                                                                                   \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsBoolean(state->m_##NAME > 0)));                                                                                 \
    }                                                                                                                                                                              \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME);                                                                                                                   \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, false);                                                                                                                                \
        }                                                                                                                                                                          \
        auto value = JSC::JSValue::decode(encodedValue);                                                                                                                           \
        state->m_##NAME = value.isNull() ? 0 : value.toBoolean(lexicalGlobalObject) ? 1                                                                                            \
                                                                                    : -1;                                                                                          \
        RELEASE_AND_RETURN(throwScope, true);                                                                                                                                      \
    }

JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(paused)
    JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER(flowing)

#undef JSReadableState_NULLABLE_BOOLEAN_GETTER_SETTER

#define JSReadableState_NUMBER_GETTER_SETTER(NAME)                                                                                                                                 \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME);                                                                                                                      \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))                                 \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));                                                                                             \
        }                                                                                                                                                                          \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(state->m_##NAME)));                                                                                      \
    }                                                                                                                                                                              \
                                                                                                                                                                                   \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME);                                                                                                                   \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, false);                                                                                                                                \
        }                                                                                                                                                                          \
        state->m_##NAME = JSC::JSValue::decode(encodedValue).toNumber(lexicalGlobalObject);                                                                                        \
        RETURN_IF_EXCEPTION(throwScope, false);                                                                                                                                    \
        RELEASE_AND_RETURN(throwScope, true);                                                                                                                                      \
    }

        JSReadableState_NUMBER_GETTER_SETTER(length)
            JSReadableState_NUMBER_GETTER_SETTER(highWaterMark)

#undef JSReadableState_NUMBER_GETTER_SETTER

#define JSReadableState_BOOLEAN_GETTER_SETTER(NAME)                                                                                                                                \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME);                                                                                                                      \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))                                 \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));                                                                                             \
        }                                                                                                                                                                          \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsBoolean(state->getBool(JSReadableState::Mask::NAME))));                                                         \
    }                                                                                                                                                                              \
                                                                                                                                                                                   \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME);                                                                                                                   \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, false);                                                                                                                                \
        }                                                                                                                                                                          \
        state->setBool(JSReadableState::Mask::NAME, JSC::JSValue::decode(encodedValue).toBoolean(lexicalGlobalObject));                                                            \
        RELEASE_AND_RETURN(throwScope, true);                                                                                                                                      \
    }

                JSReadableState_BOOLEAN_GETTER_SETTER(objectMode)
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

#undef JSReadableState_BOOLEAN_GETTER_SETTER

#define JSReadableState_JSVALUE_GETTER_SETTER(NAME)                                                                                                                                \
    static JSC_DECLARE_CUSTOM_GETTER(jsReadableState_##NAME);                                                                                                                      \
    JSC_DEFINE_CUSTOM_GETTER(jsReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))                                 \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));                                                                                             \
        }                                                                                                                                                                          \
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(state->m_##NAME.get()));                                                                                               \
    }                                                                                                                                                                              \
    static JSC_DECLARE_CUSTOM_SETTER(setJSReadableState_##NAME);                                                                                                                   \
    JSC_DEFINE_CUSTOM_SETTER(setJSReadableState_##NAME, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)) \
    {                                                                                                                                                                              \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                                                                \
        auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                                                                 \
        JSReadableState* state = JSC::jsDynamicCast<JSReadableState*>(JSValue::decode(thisValue));                                                                                 \
        if (!state) {                                                                                                                                                              \
            RETURN_IF_EXCEPTION(throwScope, false);                                                                                                                                \
        }                                                                                                                                                                          \
        auto value = JSC::JSValue::decode(encodedValue);                                                                                                                           \
        state->m_##NAME.set(vm, state, value);                                                                                                                                     \
        RELEASE_AND_RETURN(throwScope, true);                                                                                                                                      \
    }

                                                                                            JSReadableState_JSVALUE_GETTER_SETTER(buffer)
                                                                                                JSReadableState_JSVALUE_GETTER_SETTER(pipes)
                                                                                                    JSReadableState_JSVALUE_GETTER_SETTER(errored)
                                                                                                        JSReadableState_JSVALUE_GETTER_SETTER(defaultEncoding)
                                                                                                            JSReadableState_JSVALUE_GETTER_SETTER(awaitDrainWriters)
                                                                                                                JSReadableState_JSVALUE_GETTER_SETTER(decoder)
                                                                                                                    JSReadableState_JSVALUE_GETTER_SETTER(encoding)

#undef JSReadableState_JSVALUE_GETTER_SETTER

#define JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(NAME)                                                                                                                \
    {                                                                                                                                                                       \
        #NAME ""_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, \
        {                                                                                                                                                                   \
            HashTableValue::GetterSetterType, jsReadableState_##NAME, setJSReadableState_##NAME                                                                             \
        }                                                                                                                                                                   \
    }

    /* Hash table for prototype */
    static const HashTableValue JSReadableStatePrototypeTableValues[]
    = {
          { "pipesCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableState_pipesCount, 0 } },
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(paused),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(flowing),

          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(objectMode),
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

          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(buffer),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(pipes),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(errored),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(defaultEncoding),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(awaitDrainWriters),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(decoder),
          JSReadableState_GETTER_SETTER_HASH_TABLE_VALUE(encoding),
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

JSReadableStateConstructor* JSReadableStateConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStatePrototype* prototype)
{
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
    JSValue isDuplexVal = callFrame->uncheckedArgument(2);

    bool isDuplex;
    if (!isDuplexVal.isBoolean()) {
        // change this to `stream instanceof Duplex` after native Duplex is implemented.
        JSC::throwTypeError(lexicalGlobalObject, throwScope, "isDuplex should be boolean"_s);
        return JSValue::encode(jsUndefined());
    }
    isDuplex = isDuplexVal.toBoolean(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    JSObject* options = nullptr;
    if (optionsVal && optionsVal.isObject()) {
        options = optionsVal.toObject(lexicalGlobalObject);
    }
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());

    JSReadableState* stringDecoder = JSReadableState::create(
        vm, lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSReadableStateStructure(), isDuplex, options);
    return JSC::JSValue::encode(stringDecoder);
}

void JSReadableStateConstructor::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStatePrototype* prototype)
{
}

const ClassInfo JSReadableStateConstructor::s_info = { "ReadableState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStateConstructor) };

} // namespace Zig
