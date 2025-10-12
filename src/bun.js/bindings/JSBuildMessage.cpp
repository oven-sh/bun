#include "root.h"

#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSBuildMessage.h"
#include "JSBuildMessageConstructor.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/PropertySlot.h>

namespace Bun {

// Forward declaration - BuildMessage is defined in Zig
typedef void BuildMessage;

extern "C" void* BuildMessage__fromJS(JSC::EncodedJSValue value);

// External Zig functions
extern "C" BunString BuildMessage__getMessageString(void* buildMessage);
extern "C" JSC::EncodedJSValue BuildMessage__getLevel(void* buildMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BuildMessage__getPosition(void* buildMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BuildMessage__getNotes(void* buildMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BuildMessage__getLine(void* buildMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BuildMessage__getColumn(void* buildMessage, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BuildMessage__toString(void* buildMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue BuildMessage__toJSON(void* buildMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue BuildMessage__toPrimitive(void* buildMessage, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" void BuildMessage__finalize(void* buildMessage);

// External functions to unwrap tagged pointer
extern "C" void* Bun__getBuildMessage(void* taggedPtr);

// Custom getter definitions
JSC_DEFINE_CUSTOM_GETTER(jsBuildMessageGetter_level, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* buildMessage = BuildMessage__fromJS(thisValue);

    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__getLevel(buildMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsBuildMessageGetter_position, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* buildMessage = BuildMessage__fromJS(thisValue);
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__getPosition(buildMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsBuildMessageGetter_notes, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* buildMessage = BuildMessage__fromJS(thisValue);
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__getNotes(buildMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsBuildMessageGetter_line, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* buildMessage = BuildMessage__fromJS(thisValue);
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__getLine(buildMessage, globalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsBuildMessageGetter_column, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* buildMessage = BuildMessage__fromJS(thisValue);
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__getColumn(buildMessage, globalObject);
}

// Function implementations
JSC_DEFINE_HOST_FUNCTION(jsBuildMessageFunction_toString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* buildMessage = BuildMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__toString(buildMessage, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBuildMessageFunction_toJSON, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* buildMessage = BuildMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__toJSON(buildMessage, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBuildMessageFunction_toPrimitive, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* buildMessage = BuildMessage__fromJS(JSValue::encode(callFrame->thisValue()));
    if (!buildMessage)
        return JSC::JSValue::encode(jsUndefined());

    return BuildMessage__toPrimitive(buildMessage, globalObject, callFrame);
}

// HashTable for prototype properties
static const HashTableValue BuildMessagePrototypeValues[] = {
    { "level"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBuildMessageGetter_level, 0 } },
    { "position"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBuildMessageGetter_position, 0 } },
    { "notes"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBuildMessageGetter_notes, 0 } },
    { "line"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBuildMessageGetter_line, 0 } },
    { "column"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBuildMessageGetter_column, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBuildMessageFunction_toString, 0 } },
    { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBuildMessageFunction_toJSON, 0 } },
};

// Prototype class definition
class BuildMessagePrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        // Set prototype to ErrorPrototype
        return Structure::create(vm, globalObject, globalObject->errorPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    }

    static BuildMessagePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        BuildMessagePrototype* prototype = new (NotNull, JSC::allocateCell<BuildMessagePrototype>(vm)) BuildMessagePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(BuildMessagePrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, BuildMessagePrototype::info(), BuildMessagePrototypeValues, *this);

        // Add name property
        this->putDirect(vm, vm.propertyNames->name, JSC::jsString(vm, String("BuildMessage"_s)), PropertyAttribute::DontEnum | 0);

        // Add @@toPrimitive
        this->putDirect(vm, vm.propertyNames->toPrimitiveSymbol,
            JSC::JSFunction::create(vm, globalObject, 1, String(), jsBuildMessageFunction_toPrimitive, ImplementationVisibility::Private),
            PropertyAttribute::DontEnum | 0);

        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }

    BuildMessagePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo BuildMessagePrototype::s_info = {
    "BuildMessage"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(BuildMessagePrototype)
};

void setupJSBuildMessageClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = BuildMessagePrototype::createStructure(init.vm, init.global);
    auto* prototype = BuildMessagePrototype::create(init.vm, init.global, prototypeStructure);

    JSC::FunctionPrototype* functionPrototype = init.global->functionPrototype();
    auto* constructorStructure = JSBuildMessageConstructor::createStructure(init.vm, init.global, functionPrototype);
    auto* constructor = JSBuildMessageConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSC::ErrorInstance::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

// Main toJS function called from Zig
extern "C" JSC::EncodedJSValue BuildMessage__toJS(void* buildMessage, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    // Get the message for the error
    BunString messageString = BuildMessage__getMessageString(buildMessage);
    WTF::String message = messageString.transferToWTFString();

    // Get or create the structure using the lazy class structure
    JSC::Structure* structure = zigGlobalObject->m_JSBuildMessageClassStructure.get(zigGlobalObject);

    // Create the ErrorInstance with our custom structure
    // Pass false for useCurrentFrame to avoid capturing bundler internal stack frames
    JSC::ErrorInstance* errorInstance = JSC::ErrorInstance::create(
        vm, structure, message, {}, nullptr,
        JSC::RuntimeType::TypeNothing, JSC::ErrorType::Error, false);

    errorInstance->setBunErrorData(buildMessage);

    return JSC::JSValue::encode(errorInstance);
}

} // namespace Bun
