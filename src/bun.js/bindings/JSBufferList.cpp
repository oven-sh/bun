#include "JSBufferList.h"
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

/* Hash table for prototype */
static const HashTableValue JSBufferListPrototypeTableValues[]
    = {
        { "push"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_push), (intptr_t)(1) } },
        { "unshift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_unshift), (intptr_t)(1) } },
        { "shift"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_shift), (intptr_t)(0) } },
        { "clear"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_clear), (intptr_t)(0) } },
        { "first"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferListPrototypeFunction_first), (intptr_t)(0) } },
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