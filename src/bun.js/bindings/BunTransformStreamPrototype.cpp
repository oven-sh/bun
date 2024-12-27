#include "root.h"

#include "BunTransformStreamPrototype.h"
#include "BunTransformStream.h"
#include "BunBuiltinNames.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamReadableGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamWritableGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamConstructor);

// All static properties for the prototype
static const HashTableValue JSTransformStreamPrototypeTableValues[] = {
    { "readable"_s,
        static_cast<unsigned>(PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamReadableGetter, nullptr } },
    { "writable"_s,
        static_cast<unsigned>(PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamWritableGetter, nullptr } },
    { "constructor"_s,
        static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamConstructor, nullptr } }
};

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamReadableGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStream*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return throwVMTypeError(globalObject, scope, "Cannot get readable property of non-TransformStream"_s);
    }

    ASSERT(thisObject->readable());
    return JSValue::encode(thisObject->readable());
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamWritableGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStream*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return throwVMTypeError(globalObject, scope, "Cannot get writable property of non-TransformStream"_s);
    }

    ASSERT(thisObject->writable());
    return JSValue::encode(thisObject->writable());
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamConstructor, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobalObject))
        return throwVMTypeError(globalObject, scope, "Invalid global object"_s);

    return JSValue::encode(zigGlobalObject->streams().constructor<JSTransformStream>(zigGlobalObject));
}

JSTransformStreamPrototype* JSTransformStreamPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSTransformStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSTransformStreamPrototype>(vm)) JSTransformStreamPrototype(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

template<typename CellType, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSTransformStreamPrototype::subspaceFor(JSC::VM& vm)
{
    STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamPrototype, Base);
    return &vm.plainObjectSpace();
}

JSTransformStreamPrototype::JSTransformStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSTransformStreamPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(
        vm,
        JSTransformStream::info(),
        JSTransformStreamPrototypeTableValues,
        *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSTransformStreamPrototype::s_info = { "TransformStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamPrototype) };

Structure* JSTransformStreamPrototype::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(JSC::JSType::ObjectType, StructureFlags), info());
}

} // namespace Bun
