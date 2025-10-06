#include "root.h"

#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSResolveMessage.h"
#include "JSResolveMessageConstructor.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/PropertySlot.h>

namespace Bun {

// Forward declaration - ResolveMessage is defined in Zig
typedef void ResolveMessage;

extern "C" void* ResolveMessage__fromJS(JSC::EncodedJSValue value);

// External Zig functions
extern "C" BunString ResolveMessage__getMessageString(void* resolveMessage);
extern "C" JSC::EncodedJSValue ResolveMessage__getCode(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getLevel(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getReferrer(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getSpecifier(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getImportKind(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getPosition(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getLine(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__getColumn(void* resolveMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue ResolveMessage__toString(void* resolveMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue ResolveMessage__toJSON(void* resolveMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue ResolveMessage__toPrimitive(void* resolveMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" void ResolveMessage__finalize(void* resolveMessage);

// External functions to unwrap tagged pointer
extern "C" void* Bun__getResolveMessage(void* taggedPtr);

// Custom getter definitions
JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_code, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getCode(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_level, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getLevel(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_referrer, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getReferrer(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_specifier, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getSpecifier(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_importKind, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getImportKind(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_position, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getPosition(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_line, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getLine(resolveMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageGetter_column, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* resolveMessage = ResolveMessage__fromJS(thisValue);
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__getColumn(resolveMessage, globalObject);
}

// Function implementations
JSC_DEFINE_HOST_FUNCTION(jsResolveMessageFunction_toString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* resolveMessage = ResolveMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__toString(resolveMessage, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsResolveMessageFunction_toJSON, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* resolveMessage = ResolveMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__toJSON(resolveMessage, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsResolveMessageFunction_toPrimitive, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* resolveMessage = ResolveMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!resolveMessage)
        return JSC::JSValue::encode(jsUndefined());

    return ResolveMessage__toPrimitive(resolveMessage, globalObject, callFrame);
}

// HashTable for prototype properties
static const HashTableValue ResolveMessagePrototypeValues[] = {
    { "code"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_code, 0 } },
    { "level"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_level, 0 } },
    { "referrer"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_referrer, 0 } },
    { "specifier"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_specifier, 0 } },
    { "importKind"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_importKind, 0 } },
    { "position"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_position, 0 } },
    { "line"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_line, 0 } },
    { "column"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsResolveMessageGetter_column, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsResolveMessageFunction_toString, 0 } },
    { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsResolveMessageFunction_toJSON, 0 } },
};

// Prototype class definition
class ResolveMessagePrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        // Set prototype to ErrorPrototype
        return Structure::create(vm, globalObject, globalObject->errorPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    }

    static ResolveMessagePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ResolveMessagePrototype* prototype = new (NotNull, JSC::allocateCell<ResolveMessagePrototype>(vm)) ResolveMessagePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ResolveMessagePrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, ResolveMessagePrototype::info(), ResolveMessagePrototypeValues, *this);

        // Add name property
        this->putDirect(vm, vm.propertyNames->name, JSC::jsString(vm, String("ResolveMessage"_s)), PropertyAttribute::DontEnum | 0);

        // Add @@toPrimitive
        this->putDirect(vm, vm.propertyNames->toPrimitiveSymbol,
            JSC::JSFunction::create(vm, globalObject, 1, String(), jsResolveMessageFunction_toPrimitive, ImplementationVisibility::Private),
            PropertyAttribute::DontEnum | 0);

        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }

    ResolveMessagePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo ResolveMessagePrototype::s_info = {
    "ResolveMessage"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(ResolveMessagePrototype)
};

void setupJSResolveMessageClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = ResolveMessagePrototype::createStructure(init.vm, init.global);
    auto* prototype = ResolveMessagePrototype::create(init.vm, init.global, prototypeStructure);

    JSC::FunctionPrototype* functionPrototype = init.global->functionPrototype();
    auto* constructorStructure = JSResolveMessageConstructor::createStructure(init.vm, init.global, functionPrototype);
    auto* constructor = JSResolveMessageConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSC::ErrorInstance::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

// Note: Bun__errorInstance__finalize is implemented in ZigGlobalObject.cpp
// to handle both ResolveMessage and BuildMessage with proper TaggedPointerUnion checking

// Main toJS function called from Zig
extern "C" JSC::EncodedJSValue ResolveMessage__toJS(void* resolveMessage, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    // Get the message for the error
    BunString messageString = ResolveMessage__getMessageString(resolveMessage);
    WTF::String message = messageString.transferToWTFString();

    // Get or create the structure using the lazy class structure
    JSC::Structure* structure = zigGlobalObject->m_JSResolveMessageClassStructure.get(zigGlobalObject);

    // Create the ErrorInstance with our custom structure
    // Pass false for useCurrentFrame to avoid capturing bundler internal stack frames
    JSC::ErrorInstance* errorInstance = JSC::ErrorInstance::create(
        vm, structure, message, {}, nullptr,
        JSC::RuntimeType::TypeNothing, JSC::ErrorType::Error, false);

    // Create tagged pointer and set it as bunErrorData
    errorInstance->setBunErrorData(resolveMessage);

    return JSC::JSValue::encode(errorInstance);
}

}
