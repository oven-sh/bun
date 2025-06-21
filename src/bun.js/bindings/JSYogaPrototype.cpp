#include "root.h"
#include "JSYogaPrototype.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

// Config Prototype implementation
const JSC::ClassInfo JSYogaConfigPrototype::s_info = { "Yoga.Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigPrototype) };

// Forward declarations for Config prototype methods
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncIsEnabledForNodes);

// Hash table for Config prototype properties
static const JSC::HashTableValue JSYogaConfigPrototypeTableValues[] = {
    { "setUseWebDefaults"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetUseWebDefaults, 1 } },
    { "useWebDefaults"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncUseWebDefaults, 0 } },
    { "setExperimentalFeatureEnabled"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, 2 } },
    { "isExperimentalFeatureEnabled"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, 1 } },
    { "setPointScaleFactor"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetPointScaleFactor, 1 } },
    { "isEnabledForNodes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncIsEnabledForNodes, 1 } },
};

void JSYogaConfigPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSYogaConfig::info(), JSYogaConfigPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Node Prototype implementation
const JSC::ClassInfo JSYogaNodePrototype::s_info = { "Yoga.Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNodePrototype) };

// Forward declarations for Node prototype methods (just a few for now)
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncReset);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout);

// Hash table for Node prototype properties (starting with core methods)
static const JSC::HashTableValue JSYogaNodePrototypeTableValues[] = {
    { "reset"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncReset, 0 } },
    { "markDirty"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncMarkDirty, 0 } },
    { "isDirty"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncIsDirty, 0 } },
    { "calculateLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncCalculateLayout, 3 } },
    { "getComputedLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedLayout, 0 } },
};

void JSYogaNodePrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSYogaNode::info(), JSYogaNodePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Placeholder implementations for now - these will be filled in Phase 2/3
JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsEnabledForNodes, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncReset, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun