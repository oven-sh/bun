#include "root.h"
#include "JSYogaPrototype.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <yoga/Yoga.h>

namespace Bun {

// Config Prototype implementation
const JSC::ClassInfo JSYogaConfigPrototype::s_info = { "Yoga.Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigPrototype) };

// Forward declarations for Config prototype methods
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncGetPointScaleFactor);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetErrata);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncGetErrata);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncIsEnabledForNodes);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncFree);

// Hash table for Config prototype properties
static const JSC::HashTableValue JSYogaConfigPrototypeTableValues[] = {
    { "setUseWebDefaults"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetUseWebDefaults, 1 } },
    { "useWebDefaults"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncUseWebDefaults, 0 } },
    { "setExperimentalFeatureEnabled"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, 2 } },
    { "isExperimentalFeatureEnabled"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, 1 } },
    { "setPointScaleFactor"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetPointScaleFactor, 1 } },
    { "getPointScaleFactor"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncGetPointScaleFactor, 0 } },
    { "setErrata"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetErrata, 1 } },
    { "getErrata"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncGetErrata, 0 } },
    { "isEnabledForNodes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncIsEnabledForNodes, 1 } },
    { "free"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncFree, 0 } },
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

// Config method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setUseWebDefaults"_s));
    }

    bool enabled = true;
    if (callFrame->argumentCount() > 0) {
        enabled = callFrame->uncheckedArgument(0).toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    YGConfigSetUseWebDefaults(thisObject->internal(), enabled);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "useWebDefaults"_s));
    }

    // Legacy method - same as setUseWebDefaults(true)
    YGConfigSetUseWebDefaults(thisObject->internal(), true);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setExperimentalFeatureEnabled"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setExperimentalFeatureEnabled requires 2 arguments"_s);
        return {};
    }

    int32_t feature = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    bool enabled = callFrame->uncheckedArgument(1).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGConfigSetExperimentalFeatureEnabled(thisObject->internal(), static_cast<YGExperimentalFeature>(feature), enabled);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "isExperimentalFeatureEnabled"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "isExperimentalFeatureEnabled requires 1 argument"_s);
        return {};
    }

    int32_t feature = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    bool enabled = YGConfigIsExperimentalFeatureEnabled(thisObject->internal(), static_cast<YGExperimentalFeature>(feature));
    return JSC::JSValue::encode(JSC::jsBoolean(enabled));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setPointScaleFactor"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "setPointScaleFactor requires 1 argument"_s);
        return {};
    }

    double scaleFactor = callFrame->uncheckedArgument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGConfigSetPointScaleFactor(thisObject->internal(), static_cast<float>(scaleFactor));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsEnabledForNodes, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "isEnabledForNodes"_s));
    }

    // This method checks if a config is actively being used by any nodes
    // In the future, we might track this, but for now always return true if valid config
    return JSC::JSValue::encode(JSC::jsBoolean(thisObject->internal() != nullptr));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetPointScaleFactor, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getPointScaleFactor"_s));
    }

    float scaleFactor = YGConfigGetPointScaleFactor(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(scaleFactor));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetErrata, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setErrata"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "setErrata requires 1 argument"_s);
        return {};
    }

    int32_t errata = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGConfigSetErrata(thisObject->internal(), static_cast<YGErrata>(errata));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetErrata, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getErrata"_s));
    }

    YGErrata errata = YGConfigGetErrata(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int32_t>(errata)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncFree, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "free"_s));
    }

    // Mark the config as freed by setting internal pointer to nullptr
    // The actual cleanup will happen in the destructor
    if (thisObject->internal()) {
        YGConfigFree(thisObject->internal());
        thisObject->clearInternal();
    }

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