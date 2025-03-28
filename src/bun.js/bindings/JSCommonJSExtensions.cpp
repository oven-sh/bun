#include "JSCommonJSExtensions.h"
#include "ZigGlobalObject.h"

namespace Bun {
using namespace JSC;

const JSC::ClassInfo JSCommonJSExtensions::s_info = { "CommonJSExtensions"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSExtensions) };

// These functions are implemented as no-ops because it doesn't seem like any
// projects call them directly. They are defined separately so that assigning
// one to the other can be detected and use the corresponding loader.
JSC_DEFINE_HOST_FUNCTION(jsLoaderJS, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Calling Module._extensions[\".js\"] directly is not implemented."_s);
    return JSValue::encode({});
}
JSC_DEFINE_HOST_FUNCTION(jsLoaderJSON, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Calling Module._extensions[\".json\"] directly is not implemented."_s);
    return JSValue::encode({});
}
JSC_DEFINE_HOST_FUNCTION(jsLoaderNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Calling Module._extensions[\".node\"] directly is not implemented."_s);
    return JSValue::encode({});
}
JSC_DEFINE_HOST_FUNCTION(jsLoaderTS, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Calling Module._extensions[\".ts\"] directly is not implemented."_s);
    return JSValue::encode({});
}

void JSCommonJSExtensions::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    Zig::GlobalObject* global = defaultGlobalObject(globalObject());
    JSC::JSFunction* fnLoadJS = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderJS,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadJSON = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderJSON,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadNode = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderNode,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadTS = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderTS,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);

    this->putDirect(vm, JSC::Identifier::fromString(vm, ".js"_s), fnLoadJS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".json"_s), fnLoadJSON, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".node"_s), fnLoadNode, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".ts"_s), fnLoadTS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".cts"_s), fnLoadTS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".mjs"_s), fnLoadJS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".mts"_s), fnLoadTS, 0);
}

extern "C" void NodeModuleModule__onRequireExtensionModify(
    Zig::GlobalObject* globalObject,
    const BunString* key,
    uint32_t kind,
    JSC::JSValue value);

void onAssign(Zig::GlobalObject* globalObject, JSC::PropertyName propertyName, JSC::JSValue value)
{
    if (propertyName.isSymbol()) return;
    auto* name = propertyName.publicName();
    if (!name->startsWith("."_s)) return;
    BunString ext = Bun::toString(name);
    uint32_t kind = 0;
    if (value.isCallable()) {
        JSC::CallData callData = JSC::getCallData(value);
        if (callData.type == JSC::CallData::Type::Native) {
            auto* untaggedPtr = callData.native.function.untaggedPtr();
            if (untaggedPtr == &jsLoaderJS) {
                kind = 1;
            } else if (untaggedPtr == &jsLoaderJSON) {
                kind = 2;
            } else if (untaggedPtr == &jsLoaderNode) {
                kind = 3;
            } else if (untaggedPtr == &jsLoaderTS) {
                kind = 4;
            }
        }
    } else {
        kind = -1;
    }
    NodeModuleModule__onRequireExtensionModify(globalObject, &ext, kind, value);
}

bool JSCommonJSExtensions::defineOwnProperty(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, const JSC::PropertyDescriptor& descriptor, bool shouldThrow)
{
    JSValue value = descriptor.value();
    if (value) {
        onAssign(defaultGlobalObject(globalObject), propertyName, value);
    } else {
        onAssign(defaultGlobalObject(globalObject), propertyName, JSC::jsUndefined());
    }
    return Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow);
}

bool JSCommonJSExtensions::put(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::JSValue value, JSC::PutPropertySlot& slot)
{
    onAssign(defaultGlobalObject(globalObject), propertyName, value);
    return Base::put(cell, globalObject, propertyName, value, slot);
}

bool JSCommonJSExtensions::deleteProperty(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::DeletePropertySlot& slot)
{
    bool deleted = Base::deleteProperty(cell, globalObject, propertyName, slot);
    if (deleted) {
        onAssign(defaultGlobalObject(globalObject), propertyName, JSC::jsUndefined());
    }
    return deleted;
}

extern "C" uint32_t JSCommonJSExtensions__appendFunction(Zig::GlobalObject* globalObject, JSC::JSValue value)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    extensions->m_registeredFunctions.append(JSC::WriteBarrier<Unknown>());
    extensions->m_registeredFunctions.last().set(globalObject->vm(), extensions, value);
    return extensions->m_registeredFunctions.size() - 1;
}

extern "C" void JSCommonJSExtensions__setFunction(Zig::GlobalObject* globalObject, uint32_t index, JSC::JSValue value)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    extensions->m_registeredFunctions[index].set(globalObject->vm(), globalObject, value);
}

extern "C" uint32_t JSCommonJSExtensions__swapRemove(Zig::GlobalObject* globalObject, uint32_t index)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    ASSERT(extensions->m_registeredFunctions.size() > 0);
    if (extensions->m_registeredFunctions.size() == 1) {
        extensions->m_registeredFunctions.clear();
        return index;
    }
    ASSERT(index < extensions->m_registeredFunctions.size());
    if (index < (extensions->m_registeredFunctions.size() - 1)) {
        JSValue last = extensions->m_registeredFunctions.takeLast().get();
        extensions->m_registeredFunctions[index].set(globalObject->vm(), globalObject, last);
        return extensions->m_registeredFunctions.size();
    } else {
        extensions->m_registeredFunctions.removeLast();
        return index;
    }
}

} // namespace Bun
