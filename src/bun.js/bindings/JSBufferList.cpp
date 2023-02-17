#include "JSBufferList.h"
#include "JSBuffer.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "headers.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(JSBufferList_getLength);
static JSC_DEFINE_CUSTOM_GETTER(JSBufferList_getLength, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSBufferList* bufferList = JSC::jsDynamicCast<JSBufferList*>(JSValue::decode(thisValue));
    if (!bufferList)
        JSC::throwTypeError(globalObject, scope, "not calling on JSBufferList"_s);

    return JSValue::encode(JSC::jsNumber(bufferList->length()));
}

void JSBufferList::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "length"_s),
        JSC::CustomGetterSetter::create(vm, JSBufferList_getLength, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC::JSValue JSBufferList::concat(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, size_t n)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* subclassStructure = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferSubclassStructure();
    const size_t len = length();
    if (len == 0) {
        // Buffer.alloc(0)
        RELEASE_AND_RETURN(throwScope, JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, 0));
    }
    auto iter = m_deque.begin();
    if (len == 1) {
        auto array = JSC::jsDynamicCast<JSC::JSUint8Array*>(iter->get());
        if (UNLIKELY(!array)) {
            return throwTypeError(lexicalGlobalObject, throwScope, "concat can only be called when all buffers are Uint8Array"_s);
        }
        if (UNLIKELY(array->byteLength() > n)) {
            return throwRangeError(lexicalGlobalObject, throwScope, "specified size too small to fit all buffers"_s);
        }
        RELEASE_AND_RETURN(throwScope, array);
    }
    // Buffer.allocUnsafe(n >>> 0)
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(n, 1);
    if (UNLIKELY(!arrayBuffer)) {
        return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
    }
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTFMove(arrayBuffer), 0, n);

    size_t i = 0;
    for (const auto end = m_deque.end(); iter != end; ++iter) {
        auto array = JSC::jsDynamicCast<JSC::JSUint8Array*>(iter->get());
        if (UNLIKELY(!array)) {
            return throwTypeError(lexicalGlobalObject, throwScope, "concat can only be called when all buffers are Uint8Array"_s);
        }
        const size_t length = array->byteLength();
        if (UNLIKELY(i + length > n)) {
            return throwRangeError(lexicalGlobalObject, throwScope, "specified size too small to fit all buffers"_s);
        }
        if (UNLIKELY(!uint8Array->setFromTypedArray(lexicalGlobalObject, i, array, 0, length, JSC::CopyType::Unobservable))) {
            return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        }
        i += length;
    }

    memset(uint8Array->typedVector() + i, 0, n - i);

    RELEASE_AND_RETURN(throwScope, uint8Array);
}

JSC::JSValue JSBufferList::join(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSString* seq)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (length() == 0) {
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
    }
    const bool needSeq = seq->length() != 0;
    const auto end = m_deque.end();
    JSRopeString::RopeBuilder<RecordOverflow> ropeBuilder(vm);
    for (auto iter = m_deque.begin();;) {
        auto str = iter->get().toString(lexicalGlobalObject);
        if (!ropeBuilder.append(str))
            return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        if (++iter == end)
            break;
        if (needSeq)
            if (!ropeBuilder.append(seq))
                return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
    }
    RELEASE_AND_RETURN(throwScope, ropeBuilder.release());
}

JSC::JSValue JSBufferList::consume(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, size_t n, bool hasString)
{
    if (hasString)
        return _getString(vm, lexicalGlobalObject, n);
    else
        return _getBuffer(vm, lexicalGlobalObject, n);
}

JSC::JSValue JSBufferList::_getString(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, size_t total)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (total <= 0 || length() == 0) {
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
    }

    auto iter = m_deque.begin();
    JSC::JSString* str = JSC::jsDynamicCast<JSC::JSString*>(iter->get());
    if (UNLIKELY(!str)) {
        return throwTypeError(lexicalGlobalObject, throwScope, "_getString can only be called when all buffers are string"_s);
    }
    const size_t len = str->length();
    size_t n = total;

    if (n == len) {
        m_deque.removeFirst();
        RELEASE_AND_RETURN(throwScope, str);
    }
    if (n < len) {
        JSString* firstHalf = JSC::jsSubstring(lexicalGlobalObject, str, 0, n);
        iter->set(vm, this, JSC::jsSubstring(lexicalGlobalObject, str, n, len - n));
        RELEASE_AND_RETURN(throwScope, firstHalf);
    }

    JSRopeString::RopeBuilder<RecordOverflow> ropeBuilder(vm);
    for (const auto end = m_deque.end(); iter != end; ++iter) {
        JSC::JSString* str = JSC::jsDynamicCast<JSC::JSString*>(iter->get());
        if (UNLIKELY(!str)) {
            return throwTypeError(lexicalGlobalObject, throwScope, "_getString can only be called when all buffers are string"_s);
        }
        const size_t len = str->length();
        if (n < len) {
            JSString* firstHalf = JSC::jsSubstring(lexicalGlobalObject, str, 0, n);
            if (!ropeBuilder.append(firstHalf))
                return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
            iter->set(vm, this, JSC::jsSubstring(lexicalGlobalObject, str, n, len - n));
            break;
        }
        if (!ropeBuilder.append(str))
            return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        m_deque.removeFirst();
        if (n == len)
            break;
        n -= len;
    }
    RELEASE_AND_RETURN(throwScope, ropeBuilder.release());
}

JSC::JSValue JSBufferList::_getBuffer(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, size_t total)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* subclassStructure = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferSubclassStructure();
    if (total <= 0 || length() == 0) {
        // Buffer.alloc(0)
        RELEASE_AND_RETURN(throwScope, JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, 0));
    }

    auto iter = m_deque.begin();
    JSC::JSUint8Array* array = JSC::jsDynamicCast<JSC::JSUint8Array*>(iter->get());
    if (UNLIKELY(!array)) {
        return throwTypeError(lexicalGlobalObject, throwScope, "_getBuffer can only be called when all buffers are Uint8Array"_s);
    }
    const size_t len = array->byteLength();
    size_t n = total;

    if (n == len) {
        m_deque.removeFirst();
        RELEASE_AND_RETURN(throwScope, array);
    }
    if (n < len) {
        auto buffer = array->possiblySharedBuffer();
        JSC::JSUint8Array* retArray = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, buffer, 0, n);
        JSC::JSUint8Array* newArray = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, buffer, n, len - n);
        iter->set(vm, this, newArray);
        RELEASE_AND_RETURN(throwScope, retArray);
    }

    // Buffer.allocUnsafe(n >>> 0)
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(n, 1);
    if (UNLIKELY(!arrayBuffer)) {
        return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
    }
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTFMove(arrayBuffer), 0, n);
    size_t offset = 0;
    for (const auto end = m_deque.end(); iter != end; ++iter) {
        JSC::JSUint8Array* array = JSC::jsDynamicCast<JSC::JSUint8Array*>(iter->get());
        if (UNLIKELY(!array)) {
            return throwTypeError(lexicalGlobalObject, throwScope, "_getBuffer can only be called when all buffers are Uint8Array"_s);
        }
        const size_t len = array->byteLength();
        if (n < len) {
            if (UNLIKELY(!uint8Array->setFromTypedArray(lexicalGlobalObject, offset, array, 0, n, JSC::CopyType::Unobservable))) {
                return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
            }
            auto buffer = array->possiblySharedBuffer();
            JSC::JSUint8Array* newArray = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, buffer, n, len - n);
            iter->set(vm, this, newArray);
            offset += n;
            break;
        }
        if (UNLIKELY(!uint8Array->setFromTypedArray(lexicalGlobalObject, offset, array, 0, len, JSC::CopyType::Unobservable))) {
            return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        }
        m_deque.removeFirst();
        if (n == len) {
            offset += len;
            break;
        }
        n -= len;
        offset += len;
    }

    memset(uint8Array->typedVector() + offset, 0, total - offset);

    RELEASE_AND_RETURN(throwScope, uint8Array);
}

const JSC::ClassInfo JSBufferList::s_info = { "BufferList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferList) };

JSC::GCClient::IsoSubspace* JSBufferList::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBufferList, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBufferList.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBufferList = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForBufferList.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBufferList = std::forward<decltype(space)>(space); });
}

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferListPrototype, JSBufferListPrototype::Base);

template<typename Visitor>
void JSBufferList::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBufferList* buffer = jsCast<JSBufferList*>(cell);
    ASSERT_GC_OBJECT_INHERITS(buffer, info());
    Base::visitChildren(buffer, visitor);
    for (auto& val : buffer->m_deque)
        visitor.append(val);
}
DEFINE_VISIT_CHILDREN(JSBufferList);

static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_pushBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    auto v = callFrame->uncheckedArgument(0);
    castedThis->push(vm, v);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_unshiftBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    auto v = callFrame->uncheckedArgument(0);
    castedThis->unshift(vm, v);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_shiftBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->shift()));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_clearBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    castedThis->clear();
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_firstBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->first()));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_concatBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    int32_t n = callFrame->argument(0).toInt32(lexicalGlobalObject);
    if (UNLIKELY(n < 0)) {
        throwException(lexicalGlobalObject, throwScope, createError(lexicalGlobalObject, "n should be larger than or equal to 0"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->concat(vm, lexicalGlobalObject, n)));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_joinBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    JSString* s = callFrame->argument(0).toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->join(vm, lexicalGlobalObject, s)));
}
static inline JSC::EncodedJSValue jsBufferListPrototypeFunction_consumeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBufferList>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 2) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    int32_t n = callFrame->argument(0).toInt32(lexicalGlobalObject);
    if (UNLIKELY(n < 0)) {
        throwException(lexicalGlobalObject, throwScope, createError(lexicalGlobalObject, "n should be larger than or equal to 0"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    bool hasString = callFrame->argument(1).toBoolean(lexicalGlobalObject);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->consume(vm, lexicalGlobalObject, n, hasString)));
}

static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_push);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_push,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_pushBody>(*globalObject, *callFrame, "push");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_unshift);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_unshift,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_unshiftBody>(*globalObject, *callFrame, "unshift");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_shift);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_shift,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_shiftBody>(*globalObject, *callFrame, "shift");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_clear);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_clear,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_clearBody>(*globalObject, *callFrame, "clear");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_first);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_first,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_firstBody>(*globalObject, *callFrame, "first");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_concat);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_concat,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_concatBody>(*globalObject, *callFrame, "concat");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_join);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_join,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_joinBody>(*globalObject, *callFrame, "join");
}
static JSC_DECLARE_HOST_FUNCTION(jsBufferListPrototypeFunction_consume);
static JSC_DEFINE_HOST_FUNCTION(jsBufferListPrototypeFunction_consume,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSBufferList>::call<jsBufferListPrototypeFunction_consumeBody>(*globalObject, *callFrame, "consume");
}

/* Hash table for prototype */
static const HashTableValue JSBufferListPrototypeTableValues[]
    = {
          { "push"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_push, 1 } },
          { "unshift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_unshift, 1 } },
          { "shift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_shift, 0 } },
          { "clear"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_clear, 0 } },
          { "first"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_first, 0 } },
          { "concat"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_concat, 1 } },
          { "join"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_join, 1 } },
          { "consume"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferListPrototypeFunction_consume, 2 } },
      };

void JSBufferListPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    this->setPrototypeDirect(vm, globalThis->objectPrototype());
    reifyStaticProperties(vm, JSBufferList::info(), JSBufferListPrototypeTableValues, *this);
}

const ClassInfo JSBufferListPrototype::s_info = { "BufferList"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferListPrototype) };

void JSBufferListConstructor::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSBufferListPrototype* prototype)
{
    Base::finishCreation(vm, 0, "BufferList"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSBufferListConstructor* JSBufferListConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSBufferListPrototype* prototype)
{
    JSBufferListConstructor* ptr = new (NotNull, JSC::allocateCell<JSBufferListConstructor>(vm)) JSBufferListConstructor(vm, structure, construct);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

JSC::EncodedJSValue JSBufferListConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSBufferList* bufferList = JSBufferList::create(
        vm, lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferListStructure());
    return JSC::JSValue::encode(bufferList);
}

void JSBufferListConstructor::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSBufferListPrototype* prototype)
{
}

const ClassInfo JSBufferListConstructor::s_info = { "BufferList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferListConstructor) };

} // namespace Zig