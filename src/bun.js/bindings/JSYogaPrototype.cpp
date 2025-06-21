#include "root.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include "JSYogaPrototype.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PropertyTable.h>

namespace Bun {

// ================ JSYogaConfigPrototype Implementation ================

// Declare all host functions for the Config prototype
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled);

// Define the static hash table for Config properties
static const JSC::HashTableValue JSYogaConfigPrototypeTableValues[] = {
    { "setUseWebDefaults"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetUseWebDefaults, 1 } },
    { "useWebDefaults"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncUseWebDefaults, 0 } },
    { "setPointScaleFactor"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetPointScaleFactor, 1 } },
    { "isExperimentalFeatureEnabled"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, 1 } },
    { "setExperimentalFeatureEnabled"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, 2 } },
};

const JSC::ClassInfo JSYogaConfigPrototype::s_info = { "Yoga.Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigPrototype) };

void JSYogaConfigPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSYogaConfig::info(), JSYogaConfigPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Config method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Config", "setUseWebDefaults"));
    }

    bool enabled = callFrame->argument(0).toBoolean(globalObject);
    YGConfigSetUseWebDefaults(thisObject->internal(), enabled);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncUseWebDefaults, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Config", "useWebDefaults"));
    }

    bool result = YGConfigGetUseWebDefaults(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetPointScaleFactor, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Config", "setPointScaleFactor"));
    }

    float factor = callFrame->argument(0).toFloat(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    YGConfigSetPointScaleFactor(thisObject->internal(), factor);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncIsExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Config", "isExperimentalFeatureEnabled"));
    }

    int featureInt = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool result = YGConfigIsExperimentalFeatureEnabled(thisObject->internal(), static_cast<YGExperimentalFeature>(featureInt));
    return JSC::JSValue::encode(JSC::jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetExperimentalFeatureEnabled, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Config", "setExperimentalFeatureEnabled"));
    }

    int featureInt = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool enabled = callFrame->argument(1).toBoolean(globalObject);
    YGConfigSetExperimentalFeatureEnabled(thisObject->internal(), static_cast<YGExperimentalFeature>(featureInt), enabled);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// ================ JSYogaNodePrototype Implementation ================

// Declare all host functions for the Node prototype
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncCopyStyle);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncFree);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncFreeRecursive);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChildCount);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBorder);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBottom);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLeft);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedMargin);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedPadding);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedRight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedTop);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveChild);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncReset);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignItems);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignSelf);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAspectRatio);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBorder);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDisplay);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlex);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasis);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasisPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexDirection);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexGrow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexShrink);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexWrap);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetGap);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeightAuto);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeightPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetJustifyContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMarginAuto);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMarginPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeightPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidthPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeightPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidthPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetOverflow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPadding);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPaddingPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPosition);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionType);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidthAuto);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidthPercent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncUnsetMeasureFunc);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirtiedFunc);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncUnsetDirtiedFunc);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDirtiedFunc);

// Define the static hash table for Node properties (partial implementation)
static const JSC::HashTableValue JSYogaNodePrototypeTableValues[] = {
    { "calculateLayout"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncCalculateLayout, 3 } },
    { "copyStyle"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncCopyStyle, 1 } },
    { "free"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncFree, 0 } },
    { "freeRecursive"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncFreeRecursive, 0 } },
    { "getChild"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetChild, 1 } },
    { "getChildCount"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetChildCount, 0 } },
    { "getComputedLayout"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedLayout, 0 } },
    { "getParent"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetParent, 0 } },
    { "insertChild"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncInsertChild, 2 } },
    { "isDirty"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncIsDirty, 0 } },
    { "markDirty"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncMarkDirty, 0 } },
    { "removeChild"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncRemoveChild, 1 } },
    { "reset"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncReset, 0 } },
    { "setWidth"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetWidth, 1 } },
    { "setHeight"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetHeight, 1 } },
    { "setMeasureFunc"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetMeasureFunc, 1 } },
    { "unsetMeasureFunc"_s, JSC::PropertyAttribute::Function, JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncUnsetMeasureFunc, 0 } },
};

const JSC::ClassInfo JSYogaNodePrototype::s_info = { "Yoga.Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNodePrototype) };

void JSYogaNodePrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSYogaNode::info(), JSYogaNodePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Node method implementations (partial - just a few key ones)
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "calculateLayout"));
    }

    float width = YGUndefined;
    float height = YGUndefined;
    YGDirection direction = YGDirectionLTR;

    if (callFrame->argumentCount() > 0) {
        width = callFrame->argument(0).toFloat(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (callFrame->argumentCount() > 1) {
        height = callFrame->argument(1).toFloat(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (callFrame->argumentCount() > 2) {
        direction = static_cast<YGDirection>(callFrame->argument(2).toInt32(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    YGNodeCalculateLayout(thisObject->internal(), width, height, direction);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "getComputedLayout"));
    }

    auto* node = thisObject->internal();
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    
    result->putDirect(vm, vm.propertyNames->left, JSC::jsNumber(YGNodeLayoutGetLeft(node)));
    result->putDirect(vm, vm.propertyNames->top, JSC::jsNumber(YGNodeLayoutGetTop(node)));
    result->putDirect(vm, vm.propertyNames->width, JSC::jsNumber(YGNodeLayoutGetWidth(node)));
    result->putDirect(vm, vm.propertyNames->height, JSC::jsNumber(YGNodeLayoutGetHeight(node)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "getChild"));
    }

    int index = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeRef childRef = YGNodeGetChild(thisObject->internal(), index);
    if (!childRef) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(JSYogaNode::fromYGNode(childRef));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "getParent"));
    }

    YGNodeRef parentRef = YGNodeGetParent(thisObject->internal());
    if (!parentRef) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(JSYogaNode::fromYGNode(parentRef));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "insertChild"));
    }

    auto* child = jsDynamicCast<JSYogaNode*>(callFrame->argument(0));
    if (UNLIKELY(!child)) {
        return JSC::JSValue::encode(throwTypeError(globalObject, scope, "First argument must be a Yoga.Node instance"_s));
    }

    int index = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeInsertChild(thisObject->internal(), child->internal(), index);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "removeChild"));
    }

    auto* child = jsDynamicCast<JSYogaNode*>(callFrame->argument(0));
    if (UNLIKELY(!child)) {
        return JSC::JSValue::encode(throwTypeError(globalObject, scope, "First argument must be a Yoga.Node instance"_s));
    }

    YGNodeRemoveChild(thisObject->internal(), child->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChildCount, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "getChildCount"));
    }

    return JSC::JSValue::encode(JSC::jsNumber(YGNodeGetChildCount(thisObject->internal())));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncIsDirty, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "isDirty"));
    }

    return JSC::JSValue::encode(JSC::jsBoolean(YGNodeIsDirty(thisObject->internal())));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "markDirty"));
    }

    YGNodeMarkDirty(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncReset, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "reset"));
    }

    YGNodeReset(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCopyStyle, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "copyStyle"));
    }

    auto* srcNode = jsDynamicCast<JSYogaNode*>(callFrame->argument(0));
    if (UNLIKELY(!srcNode)) {
        return JSC::JSValue::encode(throwTypeError(globalObject, scope, "First argument must be a Yoga.Node instance"_s));
    }

    YGNodeCopyStyle(thisObject->internal(), srcNode->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncFree, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "free"));
    }

    // Note: The actual freeing is handled by the destructor
    // This just marks it for cleanup
    YGNodeFree(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncFreeRecursive, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "freeRecursive"));
    }

    YGNodeFreeRecursive(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Stub implementations for now
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    // TODO: Implement complex value setter pattern
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    // TODO: Implement complex value setter pattern
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    // TODO: Implement callback pattern
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncUnsetMeasureFunc, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(throwThisTypeError(globalObject, scope, "Yoga.Node", "unsetMeasureFunc"));
    }

    thisObject->m_measureFunc.clear();
    YGNodeSetMeasureFunc(thisObject->internal(), nullptr);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Stub implementations for remaining methods
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBorder, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBottom, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedHeight, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLeft, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedMargin, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedPadding, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedRight, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedTop, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedWidth, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignContent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignItems, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAlignSelf, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetAspectRatio, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBorder, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDisplay, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlex, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasis, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasisPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexDirection, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexGrow, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexShrink, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexWrap, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetGap, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeightAuto, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeightPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetJustifyContent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMarginAuto, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMarginPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeight, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeightPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidth, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidthPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeight, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeightPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidth, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidthPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetOverflow, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPadding, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPaddingPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPosition, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPositionType, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidthAuto, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidthPercent, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirtiedFunc, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncUnsetDirtiedFunc, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDirtiedFunc, (JSC::JSGlobalObject*, JSC::CallFrame*)) { return JSC::JSValue::encode(JSC::jsUndefined()); }

} // namespace Bun