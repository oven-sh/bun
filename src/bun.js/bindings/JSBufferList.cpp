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

void JSBufferList::destroy(JSCell* cell)
{
    JSBufferList* list = static_cast<JSBufferList*>(cell);
    if (list->m_head != nullptr) {
        delete list->m_head;
        list->m_head = nullptr;
    }
}

JSC::JSValue JSBufferList::concat(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, int32_t n)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSC::JSUint8Array* uint8Array = nullptr;
    if (m_length == 0) {
        // Buffer.alloc(0)
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), 0);
        toBuffer(lexicalGlobalObject, uint8Array);
        RELEASE_AND_RETURN(throwScope, uint8Array);
    }
    // Buffer.allocUnsafe(n >>> 0)
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(n, 1);
    if (UNLIKELY(!arrayBuffer)) {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        RELEASE_AND_RETURN(throwScope, JSC::jsUndefined());
    }
    uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(arrayBuffer), 0, n);
    toBuffer(lexicalGlobalObject, uint8Array);

    Entry* p = m_head;
    size_t i = 0;
    while (p != nullptr) {
        auto array = JSC::jsCast<JSC::JSUint8Array*>(p->m_data.get());
        if (array) {
          size_t length = array->byteLength();
          uint8Array->set(lexicalGlobalObject, i, array, 0, length);
          i += length;
        }
        p = p->m_next;
    }

    RELEASE_AND_RETURN(throwScope, uint8Array);
}

JSC::JSValue JSBufferList::join(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSString* s)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (m_length == 0) {
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
    }
    Entry* p = m_head;
    JSRopeString::RopeBuilder<RecordOverflow> ropeBuilder(vm);
    while (p != nullptr) {
        auto str = JSC::jsCast<JSC::JSString*>(p->m_data.get());
        if (str) {
            if (!ropeBuilder.append(str))
                return throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        }
        p = p->m_next;
    }
    RELEASE_AND_RETURN(throwScope, ropeBuilder.release());
}

JSC::JSValue JSBufferList::consume(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, int32_t n, bool hasString)
{
    if (hasString)
        return _getString(vm, lexicalGlobalObject, n);
    else
        return _getBuffer(vm, lexicalGlobalObject, n);
}

JSC::JSValue JSBufferList::_getString(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, int32_t n)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (n == 0) {
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
    }
    Entry* p = m_head;
    JSRopeString::RopeBuilder<RecordOverflow> ropeBuilder(vm);
    while (p != nullptr && n > 0)
    {
        JSC::JSString* str = JSC::jsCast<JSC::JSString*>(p->m_data.get());
        if (!str) {
            p = p->m_next;
            continue;
        }
        size_t length = str->length();
        if (length > n) {
            JSString* firstHalf = JSC::jsSubstring(lexicalGlobalObject, str, 0, n);
            ropeBuilder.append(firstHalf);

            JSString* secondHalf = JSC::jsSubstring(lexicalGlobalObject, str, n, length - n);
            p->m_data = JSC::Strong<JSCell>(vm, secondHalf);
            p = p->m_next;
        } else {
            ropeBuilder.append(str);
            p = p->m_next;
            shift();
        }
        n -= static_cast<int32_t>(length);
    }
    RELEASE_AND_RETURN(throwScope, ropeBuilder.release());
}

JSC::JSValue JSBufferList::_getBuffer(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, int32_t n)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSC::JSUint8Array* uint8Array = nullptr;
    if (n == 0) {
        // Buffer.alloc(0)
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), 0);
        toBuffer(lexicalGlobalObject, uint8Array);
        RELEASE_AND_RETURN(throwScope, uint8Array);
    }
    // Buffer.allocUnsafe(n >>> 0)
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(n, 1);
    if (UNLIKELY(!arrayBuffer)) {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        RELEASE_AND_RETURN(throwScope, JSC::jsUndefined());
    }
    uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(arrayBuffer), 0, n);
    toBuffer(lexicalGlobalObject, uint8Array);

    Entry* p = m_head;
    size_t offset = 0;
    while (p != nullptr && n > 0)
    {
        JSC::JSUint8Array* array = JSC::jsDynamicCast<JSC::JSUint8Array*>(p->m_data.get());
        if (!array) {
            p = p->m_next;
            continue;
        }
        size_t length = array->byteLength();
        if (length > n) {
            uint8Array->set(lexicalGlobalObject, offset, array, 0, n);
            // create a new array of size length - n.
            // is there a faster way to do this?
            auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(length - n, 1);
            if (UNLIKELY(!arrayBuffer)) {
                throwOutOfMemoryError(lexicalGlobalObject, throwScope);
                RELEASE_AND_RETURN(throwScope, JSC::jsUndefined());
            }
            JSC::JSUint8Array* newArray = JSC::JSUint8Array::create(
                  lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(arrayBuffer), 0, length - n);
            toBuffer(lexicalGlobalObject, newArray);

            memcpy(newArray->typedVector(), array->typedVector() + n, length - n);
            p->m_data = JSC::Strong<JSCell>(vm, newArray);
            p = p->m_next;
        } else {
            uint8Array->set(lexicalGlobalObject, offset, array, 0, length);
            p = p->m_next;
            shift();
        }
        n -= static_cast<int32_t>(length);
        offset += length;
    }
    RELEASE_AND_RETURN(throwScope, uint8Array);
}

const JSC::ClassInfo JSBufferList::s_info = { "JSBufferList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferList) };

JSC::GCClient::IsoSubspace* JSBufferList::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBufferList, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBufferList.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBufferList = WTFMove(space); },
        [](auto& spaces) { return spaces.m_subspaceForBufferList.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBufferList = WTFMove(space); });
}

class JSBufferListPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSBufferListPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferListPrototype* ptr = new (NotNull, JSC::allocateCell<JSBufferListPrototype>(vm)) JSBufferListPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSBufferListPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferListPrototype, JSBufferListPrototype::Base);

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
        { "push"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_push), (intptr_t)(1) } },
        { "unshift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_unshift), (intptr_t)(1) } },
        { "shift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_shift), (intptr_t)(0) } },
        { "clear"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_clear), (intptr_t)(0) } },
        { "first"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_first), (intptr_t)(0) } },
        { "concat"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_concat), (intptr_t)(1) } },
        { "join"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_join), (intptr_t)(1) } },
        { "consume"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_consume), (intptr_t)(2) } },
    };

void JSBufferListPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    this->setPrototypeDirect(vm, globalThis->objectPrototype());
    reifyStaticProperties(vm, JSBufferList::info(), JSBufferListPrototypeTableValues, *this);
}

const ClassInfo JSBufferListPrototype::s_info = { "BufferList"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferListPrototype) };

EncodedJSValue constructJSBufferList(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    JSBufferListPrototype* prototype = JSBufferListPrototype::create(
        vm, globalObject, JSBufferListPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    JSBufferList* bufferList = JSBufferList::create(
        vm, globalObject, JSBufferList::createStructure(vm, globalObject, prototype));
    return JSC::JSValue::encode(bufferList);
}

} // namespace Zig