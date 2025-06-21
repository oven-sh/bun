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

// Forward declarations for Node prototype methods
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncReset);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncFree);

// Style setters
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasis);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPadding);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPosition);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetGap);

// Style getters
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexBasis);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMargin);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPadding);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPosition);

// Layout properties
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexDirection);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetJustifyContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignItems);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignSelf);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexWrap);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionType);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDisplay);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetOverflow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlex);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexGrow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexShrink);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAspectRatio);

// Hierarchy
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChildCount);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent);

// Callbacks
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirtiedFunc);

// External implementations
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent);
JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc);

// Hash table for Node prototype properties
static const JSC::HashTableValue JSYogaNodePrototypeTableValues[] = {
    { "reset"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncReset, 0 } },
    { "markDirty"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncMarkDirty, 0 } },
    { "isDirty"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncIsDirty, 0 } },
    { "calculateLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncCalculateLayout, 3 } },
    { "getComputedLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedLayout, 0 } },
    { "free"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncFree, 0 } },

    // Style setters
    { "setWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetWidth, 1 } },
    { "setHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetHeight, 1 } },
    { "setMinWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMinWidth, 1 } },
    { "setMinHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMinHeight, 1 } },
    { "setMaxWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMaxWidth, 1 } },
    { "setMaxHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMaxHeight, 1 } },
    { "setFlexBasis"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlexBasis, 1 } },
    { "setMargin"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMargin, 2 } },
    { "setPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetPadding, 2 } },
    { "setPosition"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetPosition, 2 } },
    { "setGap"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetGap, 2 } },

    // Style getters
    { "getWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetWidth, 0 } },
    { "getHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetHeight, 0 } },
    { "getMinWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetMinWidth, 0 } },
    { "getMinHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetMinHeight, 0 } },
    { "getMaxWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetMaxWidth, 0 } },
    { "getMaxHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetMaxHeight, 0 } },
    { "getFlexBasis"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlexBasis, 0 } },
    { "getMargin"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetMargin, 1 } },
    { "getPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetPadding, 1 } },
    { "getPosition"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetPosition, 1 } },

    // Layout properties
    { "setFlexDirection"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlexDirection, 1 } },
    { "setJustifyContent"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetJustifyContent, 1 } },
    { "setAlignItems"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetAlignItems, 1 } },
    { "setAlignSelf"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetAlignSelf, 1 } },
    { "setAlignContent"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetAlignContent, 1 } },
    { "setFlexWrap"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlexWrap, 1 } },
    { "setPositionType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetPositionType, 1 } },
    { "setDisplay"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetDisplay, 1 } },
    { "setOverflow"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetOverflow, 1 } },
    { "setFlex"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlex, 1 } },
    { "setFlexGrow"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlexGrow, 1 } },
    { "setFlexShrink"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetFlexShrink, 1 } },
    { "setAspectRatio"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetAspectRatio, 1 } },

    // Hierarchy
    { "insertChild"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncInsertChild, 2 } },
    { "removeChild"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncRemoveChild, 1 } },
    { "getChildCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetChildCount, 0 } },
    { "getChild"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetChild, 1 } },
    { "getParent"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetParent, 0 } },

    // Callbacks
    { "setMeasureFunc"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMeasureFunc, 1 } },
    { "setDirtiedFunc"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetDirtiedFunc, 1 } },
};

void JSYogaNodePrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSYogaNode::info(), JSYogaNodePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Config method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsEnabledForNodes, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetPointScaleFactor, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetErrata, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetErrata, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncFree, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

// Node method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncReset, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "reset"_s));
    }

    YGNodeReset(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "markDirty"_s));
    }

    YGNodeMarkDirty(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "isDirty"_s));
    }

    bool isDirty = YGNodeIsDirty(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(isDirty));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "calculateLayout"_s));
    }

    float width = YGUndefined;
    float height = YGUndefined;
    YGDirection direction = YGDirectionLTR;

    // Parse arguments: calculateLayout(width?, height?, direction?)
    if (callFrame->argumentCount() > 0) {
        JSValue widthArg = callFrame->uncheckedArgument(0);
        if (!widthArg.isUndefinedOrNull()) {
            width = static_cast<float>(widthArg.toNumber(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (callFrame->argumentCount() > 1) {
        JSValue heightArg = callFrame->uncheckedArgument(1);
        if (!heightArg.isUndefinedOrNull()) {
            height = static_cast<float>(heightArg.toNumber(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (callFrame->argumentCount() > 2) {
        int32_t dir = callFrame->uncheckedArgument(2).toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        direction = static_cast<YGDirection>(dir);
    }

    YGNodeCalculateLayout(thisObject->internal(), width, height, direction);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedLayout"_s));
    }

    // Create object with computed layout values
    JSC::JSObject* layout = JSC::constructEmptyObject(globalObject);

    YGNodeRef node = thisObject->internal();

    layout->putDirect(vm, JSC::Identifier::fromString(vm, "left"_s), JSC::jsNumber(YGNodeLayoutGetLeft(node)));
    layout->putDirect(vm, JSC::Identifier::fromString(vm, "top"_s), JSC::jsNumber(YGNodeLayoutGetTop(node)));
    layout->putDirect(vm, JSC::Identifier::fromString(vm, "width"_s), JSC::jsNumber(YGNodeLayoutGetWidth(node)));
    layout->putDirect(vm, JSC::Identifier::fromString(vm, "height"_s), JSC::jsNumber(YGNodeLayoutGetHeight(node)));

    return JSC::JSValue::encode(layout);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncFree, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "free"_s));
    }

    // Clear the internal pointer - actual cleanup in destructor
    if (thisObject->internal()) {
        YGNodeFree(thisObject->internal());
        thisObject->clearInternal();
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Layout property setters (simple enum setters)
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexDirection, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexDirection"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t direction = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetFlexDirection(thisObject->internal(), static_cast<YGFlexDirection>(direction));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetJustifyContent, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setJustifyContent"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t justify = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetJustifyContent(thisObject->internal(), static_cast<YGJustify>(justify));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignItems, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignItems"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t align = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetAlignItems(thisObject->internal(), static_cast<YGAlign>(align));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignSelf, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignSelf"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t align = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetAlignSelf(thisObject->internal(), static_cast<YGAlign>(align));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignContent, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignContent"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t align = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetAlignContent(thisObject->internal(), static_cast<YGAlign>(align));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexWrap, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexWrap"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t wrap = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetFlexWrap(thisObject->internal(), static_cast<YGWrap>(wrap));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionType, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPositionType"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t posType = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetPositionType(thisObject->internal(), static_cast<YGPositionType>(posType));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDisplay, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setDisplay"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t display = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetDisplay(thisObject->internal(), static_cast<YGDisplay>(display));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetOverflow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setOverflow"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t overflow = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetOverflow(thisObject->internal(), static_cast<YGOverflow>(overflow));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Flex properties
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlex, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlex"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    float flex = static_cast<float>(callFrame->uncheckedArgument(0).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetFlex(thisObject->internal(), flex);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexGrow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexGrow"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    float flexGrow = static_cast<float>(callFrame->uncheckedArgument(0).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetFlexGrow(thisObject->internal(), flexGrow);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexShrink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexShrink"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    float flexShrink = static_cast<float>(callFrame->uncheckedArgument(0).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetFlexShrink(thisObject->internal(), flexShrink);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAspectRatio, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAspectRatio"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSValue arg = callFrame->uncheckedArgument(0);

    if (arg.isUndefinedOrNull()) {
        YGNodeStyleSetAspectRatio(thisObject->internal(), YGUndefined);
    } else {
        float aspectRatio = static_cast<float>(arg.toNumber(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        YGNodeStyleSetAspectRatio(thisObject->internal(), aspectRatio);
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Hierarchy methods
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveChild, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "removeChild"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "removeChild requires 1 argument"_s);
        return {};
    }

    auto* childNode = jsDynamicCast<JSYogaNode*>(callFrame->uncheckedArgument(0));
    if (!childNode) {
        throwTypeError(globalObject, scope, "Argument must be a Yoga.Node"_s);
        return {};
    }

    YGNodeRemoveChild(thisObject->internal(), childNode->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChildCount, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getChildCount"_s));
    }

    uint32_t count = YGNodeGetChildCount(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(count));
}

// Dirtied function callback
static void bunDirtiedCallback(YGNodeConstRef ygNode)
{
    JSYogaNode* jsNode = JSYogaNode::fromYGNode(const_cast<YGNodeRef>(ygNode));
    if (!jsNode || !jsNode->m_dirtiedFunc) return;

    JSC::JSGlobalObject* globalObject = jsNode->globalObject();
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSC::MarkedArgumentBuffer args;
    JSC::call(globalObject, jsNode->m_dirtiedFunc.get(), jsNode, args);
    if (scope.exception()) {
        scope.clearException();
    }
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirtiedFunc, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setDirtiedFunc"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSValue func = callFrame->uncheckedArgument(0);
    if (func.isUndefinedOrNull()) {
        thisObject->m_dirtiedFunc.clear();
        YGNodeSetDirtiedFunc(thisObject->internal(), nullptr);
    } else if (func.isCallable()) {
        thisObject->m_dirtiedFunc.set(vm, thisObject, func.getObject());
        YGNodeSetDirtiedFunc(thisObject->internal(), bunDirtiedCallback);
    } else {
        throwTypeError(globalObject, scope, "Dirtied function must be callable or null"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun
