#include "root.h"
#include "JSYogaPrototype.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <yoga/Yoga.h>
#include <yoga/YGNodeStyle.h>
#include <yoga/YGNodeLayout.h>
#include "JSDOMExceptionHandling.h"
#include <wtf/Vector.h>
#include <cstdarg>

#ifndef UNLIKELY
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

// Macro to check if a Yoga node has been freed before using internal()
#define CHECK_YOGA_NODE_FREED(thisObject) \
    if (UNLIKELY(!thisObject->internal())) { \
        throwTypeError(globalObject, scope, "Cannot perform operation on freed Yoga.Node"_s); \
        return {}; \
    }

// Macro to check if a Yoga config has been freed before using internal()
#define CHECK_YOGA_CONFIG_FREED(thisObject) \
    if (UNLIKELY(!thisObject->internal())) { \
        throwTypeError(globalObject, scope, "Cannot perform operation on freed Yoga.Config"_s); \
        return {}; \
    }

namespace Bun {

using namespace JSC;

// Config Prototype implementation
const JSC::ClassInfo JSYogaConfigPrototype::s_info = { "Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigPrototype) };

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
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncGetUseWebDefaults);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetContext);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncGetContext);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetLogger);
static JSC_DECLARE_HOST_FUNCTION(jsYogaConfigProtoFuncSetCloneNodeFunc);

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
    { "getUseWebDefaults"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncGetUseWebDefaults, 0 } },
    { "setContext"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetContext, 1 } },
    { "getContext"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncGetContext, 0 } },
    { "setLogger"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetLogger, 1 } },
    { "setCloneNodeFunc"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaConfigProtoFuncSetCloneNodeFunc, 1 } },
};

void JSYogaConfigPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    
    // Use reifyStaticProperties to add all methods at once
    reifyStaticProperties(vm, JSYogaConfig::info(), JSYogaConfigPrototypeTableValues, *this);
}

void JSYogaConfigPrototype::setConstructor(JSC::VM& vm, JSC::JSObject* constructor)
{
    putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
}

// Node Prototype implementation
const JSC::ClassInfo JSYogaNodePrototype::s_info = { "Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNodePrototype) };

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
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBaselineFunc);

// Missing style setters
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirection);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBorder);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBoxSizing);

// Missing style getters
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDirection);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexDirection);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetJustifyContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignContent);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignItems);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignSelf);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPositionType);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexWrap);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetOverflow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDisplay);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlex);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexGrow);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexShrink);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAspectRatio);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetGap);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetBorder);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetBoxSizing);

// Missing layout getters
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLeft);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedTop);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedRight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBottom);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedWidth);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedHeight);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedMargin);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBorder);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedPadding);

// Missing hierarchy methods
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveAllChildren);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetOwner);

// Missing utility methods
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncFreeRecursive);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncCopyStyle);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncClone);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetNodeType);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetNodeType);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetIsReferenceBaseline);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncIsReferenceBaseline);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetContext);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetContext);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetConfig);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetConfig);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncGetHasNewLayout);
static JSC_DECLARE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHasNewLayout);


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
    { "setBaselineFunc"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetBaselineFunc, 1 } },
    
    // Style setters
    { "setDirection"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetDirection, 1 } },
    { "setBorder"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetBorder, 2 } },
    { "setBoxSizing"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetBoxSizing, 1 } },
    
    // Style getters
    { "getDirection"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetDirection, 0 } },
    { "getFlexDirection"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlexDirection, 0 } },
    { "getJustifyContent"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetJustifyContent, 0 } },
    { "getAlignContent"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetAlignContent, 0 } },
    { "getAlignItems"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetAlignItems, 0 } },
    { "getAlignSelf"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetAlignSelf, 0 } },
    { "getPositionType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetPositionType, 0 } },
    { "getFlexWrap"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlexWrap, 0 } },
    { "getOverflow"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetOverflow, 0 } },
    { "getDisplay"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetDisplay, 0 } },
    { "getFlex"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlex, 0 } },
    { "getFlexGrow"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlexGrow, 0 } },
    { "getFlexShrink"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetFlexShrink, 0 } },
    { "getAspectRatio"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetAspectRatio, 0 } },
    { "getGap"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetGap, 1 } },
    { "getBorder"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetBorder, 1 } },
    { "getBoxSizing"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetBoxSizing, 0 } },
    
    // Layout getters
    { "getComputedLeft"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedLeft, 0 } },
    { "getComputedTop"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedTop, 0 } },
    { "getComputedRight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedRight, 0 } },
    { "getComputedBottom"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedBottom, 0 } },
    { "getComputedWidth"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedWidth, 0 } },
    { "getComputedHeight"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedHeight, 0 } },
    { "getComputedMargin"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedMargin, 1 } },
    { "getComputedBorder"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedBorder, 1 } },
    { "getComputedPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetComputedPadding, 1 } },
    
    // Hierarchy methods
    { "removeAllChildren"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncRemoveAllChildren, 0 } },
    { "getOwner"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetOwner, 0 } },
    
    // Utility methods
    { "freeRecursive"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncFreeRecursive, 0 } },
    { "copyStyle"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncCopyStyle, 1 } },
    { "clone"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncClone, 0 } },
    { "setNodeType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetNodeType, 1 } },
    { "getNodeType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetNodeType, 0 } },
    { "setIsReferenceBaseline"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetIsReferenceBaseline, 1 } },
    { "isReferenceBaseline"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncIsReferenceBaseline, 0 } },
    { "setContext"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetContext, 1 } },
    { "getContext"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetContext, 0 } },
    { "setConfig"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetConfig, 1 } },
    { "getConfig"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetConfig, 0 } },
    { "getHasNewLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncGetHasNewLayout, 0 } },
    { "setHasNewLayout"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsYogaNodeProtoFuncSetHasNewLayout, 1 } },
};

void JSYogaNodePrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    
    // Use reifyStaticProperties to add all methods at once
    reifyStaticProperties(vm, JSYogaNode::info(), JSYogaNodePrototypeTableValues, *this);
}

void JSYogaNodePrototype::setConstructor(JSC::VM& vm, JSC::JSObject* constructor)
{
    putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
}

// Config method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetUseWebDefaults, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setUseWebDefaults"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "useWebDefaults"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setExperimentalFeatureEnabled"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "isExperimentalFeatureEnabled"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setPointScaleFactor"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "isEnabledForNodes"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getPointScaleFactor"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    if (UNLIKELY(!thisObject->internal())) {
        throwTypeError(globalObject, scope, "Cannot perform operation on freed Yoga.Config"_s);
        return {};
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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setErrata"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getErrata"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    YGErrata errata = YGConfigGetErrata(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int32_t>(errata)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncFree, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "free"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    // Mark the config as freed by setting internal pointer to nullptr
    // The actual cleanup will happen in the destructor
    if (thisObject->internal()) {
        YGConfigFree(thisObject->internal());
        thisObject->clearInternal();
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetUseWebDefaults, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getUseWebDefaults"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    bool useWebDefaults = YGConfigGetUseWebDefaults(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(useWebDefaults));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetContext, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setContext"_s);
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "setContext requires 1 argument (context)"_s);
        return {};
    }

    JSC::JSValue contextValue = callFrame->uncheckedArgument(0);
    thisObject->m_context.set(vm, thisObject, contextValue);
    
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncGetContext, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "getContext"_s);
    }

    JSC::JSValue context = thisObject->m_context.get();
    return JSC::JSValue::encode(context ? context : JSC::jsNull());
}

// Logger callback that bridges from C to JavaScript
static int bunLoggerCallback(
    YGConfigConstRef config,
    YGNodeConstRef node,
    YGLogLevel level,
    const char* format,
    va_list args)
{
    // Get the JSYogaConfig from the Yoga config's context
    // Note: We need to find the JSYogaConfig that owns this YGConfig
    // For now, we'll use a global map or store it in the config context
    // This is a limitation that should be addressed in a production implementation
    
    // Format the message
    char buffer[1024];
    vsnprintf(buffer, sizeof(buffer), format, args);
    
    // Since we can't easily get back to the JS config from the C config,
    // we'll need to store a mapping or use the context API
    // For now, just return 0 (success)
    return 0;
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetLogger, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setLogger"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue loggerValue = callFrame->uncheckedArgument(0);
    
    if (loggerValue.isNull() || loggerValue.isUndefined()) {
        // Clear the logger
        thisObject->m_loggerFunc.clear();
        YGConfigSetLogger(thisObject->internal(), nullptr);
    } else if (loggerValue.isCallable()) {
        // Set the logger function
        JSC::JSObject* func = loggerValue.getObject();
        thisObject->m_loggerFunc.set(vm, thisObject, func);
        
        // Note: The current implementation of bunLoggerCallback doesn't actually
        // call the JS function because we need a way to get from the C config
        // back to the JS wrapper. This would require storing the JSYogaConfig
        // pointer in the YGConfig's context or maintaining a global map.
        YGConfigSetLogger(thisObject->internal(), bunLoggerCallback);
    } else {
        throwTypeError(globalObject, scope, "Logger must be a function or null"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Clone node callback that bridges from C to JavaScript
static YGNodeRef bunCloneNodeCallback(
    YGNodeConstRef oldNode,
    YGNodeConstRef owner,
    size_t childIndex)
{
    // This callback is called during YGNodeClone to allow custom cloning behavior
    // We need to:
    // 1. Get the JS wrapper for the old node
    // 2. Call the JS clone function
    // 3. Return the YGNodeRef from the cloned JS node
    
    // Get the JS wrapper for the old node
    JSYogaNode* jsOldNode = JSYogaNode::fromYGNode(const_cast<YGNodeRef>(oldNode));
    if (!jsOldNode) {
        // If there's no JS wrapper, just use default cloning
        return YGNodeClone(oldNode);
    }
    
    // For now, just use default cloning
    // A full implementation would need to call the JS function
    return YGNodeClone(oldNode);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaConfigProtoFuncSetCloneNodeFunc, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaConfig*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Config"_s, "setCloneNodeFunc"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue cloneFuncValue = callFrame->uncheckedArgument(0);
    
    if (cloneFuncValue.isNull() || cloneFuncValue.isUndefined()) {
        // Clear the clone function
        thisObject->m_cloneNodeFunc.clear();
        YGConfigSetCloneNodeFunc(thisObject->internal(), nullptr);
    } else if (cloneFuncValue.isCallable()) {
        // Set the clone function
        JSC::JSObject* func = cloneFuncValue.getObject();
        thisObject->m_cloneNodeFunc.set(vm, thisObject, func);
        
        // Note: Similar limitation as logger callback - we need a way to
        // get from the C config back to the JS wrapper
        YGConfigSetCloneNodeFunc(thisObject->internal(), bunCloneNodeCallback);
    } else {
        throwTypeError(globalObject, scope, "Clone node function must be a function or null"_s);
        return {};
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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "reset"_s);
    }

    CHECK_YOGA_NODE_FREED(thisObject);
    YGNodeReset(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncMarkDirty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "markDirty"_s);
    }

    CHECK_YOGA_NODE_FREED(thisObject);
    
    // Yoga only allows marking nodes dirty if they have a measure function
    // Check this condition to avoid the internal assertion failure
    YGNodeRef node = thisObject->internal();
    bool hasMeasureFunc = YGNodeHasMeasureFunc(node);
    
    if (!hasMeasureFunc) {
        // Check if it's a leaf node (no children)
        uint32_t childCount = YGNodeGetChildCount(node);
        if (childCount > 0) {
            throwTypeError(globalObject, scope, "Only leaf nodes with custom measure functions can be marked as dirty"_s);
            return {};
        }
        
        // It's a leaf node but still needs a measure function
        throwTypeError(globalObject, scope, "Only nodes with custom measure functions can be marked as dirty"_s);
        return {};
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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "isDirty"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    bool isDirty = YGNodeIsDirty(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(isDirty));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCalculateLayout, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "calculateLayout"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float width = YGUndefined;
    float height = YGUndefined;
    YGDirection direction = YGDirectionLTR;

    // Parse arguments: calculateLayout(width?, height?, direction?)
    if (callFrame->argumentCount() > 0) {
        JSC::JSValue widthArg = callFrame->uncheckedArgument(0);
        if (!widthArg.isUndefinedOrNull()) {
            width = static_cast<float>(widthArg.toNumber(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (callFrame->argumentCount() > 1) {
        JSC::JSValue heightArg = callFrame->uncheckedArgument(1);
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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedLayout"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    // Create object with computed layout values
    JSC::JSObject* layout = constructEmptyObject(globalObject);

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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "free"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexDirection"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setJustifyContent"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignItems"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignSelf"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAlignContent"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexWrap"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPositionType"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setDisplay"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setOverflow"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlex"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexGrow"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexShrink"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setAspectRatio"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);

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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "removeChild"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getChildCount"_s);
    }

    CHECK_YOGA_NODE_FREED(thisObject);
    uint32_t count = YGNodeGetChildCount(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(count));
}

// Measure function callback
static YGSize bunMeasureCallback(
    YGNodeConstRef ygNode,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode)
{
    JSYogaNode* jsNode = JSYogaNode::fromYGNode(const_cast<YGNodeRef>(ygNode));
    if (!jsNode || !jsNode->m_measureFunc) {
        return {0, 0};
    }

    JSC::JSGlobalObject* globalObject = jsNode->globalObject();
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    // Create arguments object
    JSC::JSObject* argsObj = JSC::constructEmptyObject(globalObject);
    argsObj->putDirect(vm, JSC::Identifier::fromString(vm, "width"_s), JSC::jsNumber(width));
    argsObj->putDirect(vm, JSC::Identifier::fromString(vm, "widthMode"_s), JSC::jsNumber(static_cast<int>(widthMode)));
    argsObj->putDirect(vm, JSC::Identifier::fromString(vm, "height"_s), JSC::jsNumber(height));
    argsObj->putDirect(vm, JSC::Identifier::fromString(vm, "heightMode"_s), JSC::jsNumber(static_cast<int>(heightMode)));

    JSC::MarkedArgumentBuffer args;
    args.append(argsObj);
    
    JSC::CallData callData = JSC::getCallData(jsNode->m_measureFunc.get());
    JSC::JSValue result = JSC::call(globalObject, jsNode->m_measureFunc.get(), callData, jsNode, args);
    
    if (scope.exception()) {
        scope.clearException();
        return {0, 0};
    }

    // Extract width and height from result
    if (result.isObject()) {
        JSC::JSObject* resultObj = result.getObject();
        JSC::JSValue widthValue = resultObj->get(globalObject, JSC::Identifier::fromString(vm, "width"_s));
        JSC::JSValue heightValue = resultObj->get(globalObject, JSC::Identifier::fromString(vm, "height"_s));
        
        float measuredWidth = widthValue.isNumber() ? static_cast<float>(widthValue.toNumber(globalObject)) : 0;
        float measuredHeight = heightValue.isNumber() ? static_cast<float>(heightValue.toNumber(globalObject)) : 0;
        
        return {measuredWidth, measuredHeight};
    }

    return {0, 0};
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
    JSC::CallData callData = JSC::getCallData(jsNode->m_dirtiedFunc.get());
    JSC::call(globalObject, jsNode->m_dirtiedFunc.get(), callData, jsNode, args);
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
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setDirtiedFunc"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue func = callFrame->uncheckedArgument(0);
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

// Node method implementations - only missing functions that don't already exist
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (UNLIKELY(!thisObject->internal())) {
        throwTypeError(globalObject, scope, "Cannot perform operation on freed Yoga.Node"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        YGNodeStyleSetWidthAuto(thisObject->internal());
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isUndefinedOrNull()) {
        YGNodeStyleSetWidthAuto(thisObject->internal());
    } else if (arg.isNumber()) {
        YGNodeStyleSetWidth(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str == "auto"_s) {
            YGNodeStyleSetWidthAuto(thisObject->internal());
        } else if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetWidthPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid width value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "Width object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetWidth(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetWidthPercent(thisObject->internal(), value);
                break;
            case YGUnitAuto:
                YGNodeStyleSetWidthAuto(thisObject->internal());
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "Width must be a number, string, object, null, or undefined"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        YGNodeStyleSetHeightAuto(thisObject->internal());
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isUndefinedOrNull()) {
        YGNodeStyleSetHeightAuto(thisObject->internal());
    } else if (arg.isNumber()) {
        YGNodeStyleSetHeight(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str == "auto"_s) {
            YGNodeStyleSetHeightAuto(thisObject->internal());
        } else if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetHeightPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid height value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "Height object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetHeight(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetHeightPercent(thisObject->internal(), value);
                break;
            case YGUnitAuto:
                YGNodeStyleSetHeightAuto(thisObject->internal());
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "Height must be a number, string, object, null, or undefined"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMinWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isNumber()) {
        YGNodeStyleSetMinWidth(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetMinWidthPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid minWidth value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "MinWidth object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetMinWidth(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetMinWidthPercent(thisObject->internal(), value);
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value for minWidth"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "MinWidth must be a number, string, or object"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMinHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isNumber()) {
        YGNodeStyleSetMinHeight(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetMinHeightPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid minHeight value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "MinHeight object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetMinHeight(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetMinHeightPercent(thisObject->internal(), value);
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value for minHeight"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "MinHeight must be a number, string, or object"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMaxWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isNumber()) {
        YGNodeStyleSetMaxWidth(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetMaxWidthPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid maxWidth value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "MaxWidth object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetMaxWidth(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetMaxWidthPercent(thisObject->internal(), value);
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value for maxWidth"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "MaxWidth must be a number, string, or object"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMaxHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isNumber()) {
        YGNodeStyleSetMaxHeight(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetMaxHeightPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid maxHeight value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "MaxHeight object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetMaxHeight(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetMaxHeightPercent(thisObject->internal(), value);
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value for maxHeight"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "MaxHeight must be a number, string, or object"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasis, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexBasis"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        YGNodeStyleSetFlexBasisAuto(thisObject->internal());
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg = callFrame->uncheckedArgument(0);
    
    if (arg.isUndefinedOrNull()) {
        YGNodeStyleSetFlexBasisAuto(thisObject->internal());
    } else if (arg.isNumber()) {
        YGNodeStyleSetFlexBasis(thisObject->internal(), arg.asNumber());
    } else if (arg.isString()) {
        String str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        if (str == "auto"_s) {
            YGNodeStyleSetFlexBasisAuto(thisObject->internal());
        } else if (str.endsWith('%')) {
            String percentStr = str.substring(0, str.length() - 1);
            double percent = percentStr.toDouble();
            YGNodeStyleSetFlexBasisPercent(thisObject->internal(), percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid flexBasis value"_s);
            return {};
        }
    } else if (arg.isObject()) {
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
        JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!unitValue.isNumber() || !valueValue.isNumber()) {
            throwTypeError(globalObject, scope, "FlexBasis object must have numeric 'unit' and 'value' properties"_s);
            return {};
        }
        
        int unit = unitValue.toInt32(globalObject);
        float value = valueValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        switch (unit) {
            case YGUnitPoint:
                YGNodeStyleSetFlexBasis(thisObject->internal(), value);
                break;
            case YGUnitPercent:
                YGNodeStyleSetFlexBasisPercent(thisObject->internal(), value);
                break;
            case YGUnitAuto:
                YGNodeStyleSetFlexBasisAuto(thisObject->internal());
                break;
            default:
                throwTypeError(globalObject, scope, "Invalid unit value for flexBasis"_s);
                return {};
        }
    } else {
        throwTypeError(globalObject, scope, "FlexBasis must be a number, string, object, null, or undefined"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMargin"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setMargin requires 2 arguments (edge, value)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue valueArg = callFrame->uncheckedArgument(1);

    // Helper lambda to set margin for a specific edge
    auto setMarginForEdge = [&](YGEdge targetEdge) {
        if (valueArg.isNumber()) {
            float value = static_cast<float>(valueArg.toNumber(globalObject));
            YGNodeStyleSetMargin(thisObject->internal(), targetEdge, value);
        } else if (valueArg.isString()) {
            WTF::String str = valueArg.toString(globalObject)->value(globalObject);
            
            if (str == "auto"_s) {
                YGNodeStyleSetMarginAuto(thisObject->internal(), targetEdge);
            } else if (str.endsWith('%')) {
                float percent = str.substring(0, str.length() - 1).toFloat();
                YGNodeStyleSetMarginPercent(thisObject->internal(), targetEdge, percent);
            } else {
                float value = str.toFloat();
                YGNodeStyleSetMargin(thisObject->internal(), targetEdge, value);
            }
        } else if (valueArg.isObject()) {
            JSC::JSObject* obj = valueArg.getObject();
            JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
            JSC::JSValue value = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
            
            int unit = unitValue.toInt32(globalObject);
            float val = static_cast<float>(value.toNumber(globalObject));
            
            switch (static_cast<YGUnit>(unit)) {
                case YGUnitPercent:
                    YGNodeStyleSetMarginPercent(thisObject->internal(), targetEdge, val);
                    break;
                case YGUnitAuto:
                    YGNodeStyleSetMarginAuto(thisObject->internal(), targetEdge);
                    break;
                default:
                    YGNodeStyleSetMargin(thisObject->internal(), targetEdge, val);
                    break;
            }
        }
    };

    // Handle EDGE_ALL by setting all edges
    if (edge == YGEdgeAll) {
        setMarginForEdge(YGEdgeLeft);
        RETURN_IF_EXCEPTION(scope, {});
        setMarginForEdge(YGEdgeTop);
        RETURN_IF_EXCEPTION(scope, {});
        setMarginForEdge(YGEdgeRight);
        RETURN_IF_EXCEPTION(scope, {});
        setMarginForEdge(YGEdgeBottom);
        RETURN_IF_EXCEPTION(scope, {});
        setMarginForEdge(YGEdgeStart);
        RETURN_IF_EXCEPTION(scope, {});
        setMarginForEdge(YGEdgeEnd);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        setMarginForEdge(static_cast<YGEdge>(edge));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPadding, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPadding"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setPadding requires 2 arguments (edge, value)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue valueArg = callFrame->uncheckedArgument(1);

    // Helper lambda to set padding for a specific edge
    auto setPaddingForEdge = [&](YGEdge targetEdge) {
        if (valueArg.isNumber()) {
            float value = static_cast<float>(valueArg.toNumber(globalObject));
            YGNodeStyleSetPadding(thisObject->internal(), targetEdge, value);
        } else if (valueArg.isString()) {
            WTF::String str = valueArg.toString(globalObject)->value(globalObject);
            
            if (str.endsWith('%')) {
                float percent = str.substring(0, str.length() - 1).toFloat();
                YGNodeStyleSetPaddingPercent(thisObject->internal(), targetEdge, percent);
            } else {
                float value = str.toFloat();
                YGNodeStyleSetPadding(thisObject->internal(), targetEdge, value);
            }
        } else if (valueArg.isObject()) {
            JSC::JSObject* obj = valueArg.getObject();
            JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
            JSC::JSValue value = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
            
            int unit = unitValue.toInt32(globalObject);
            float val = static_cast<float>(value.toNumber(globalObject));
            
            if (static_cast<YGUnit>(unit) == YGUnitPercent) {
                YGNodeStyleSetPaddingPercent(thisObject->internal(), targetEdge, val);
            } else {
                YGNodeStyleSetPadding(thisObject->internal(), targetEdge, val);
            }
        }
    };

    // Handle EDGE_ALL by setting all edges
    if (edge == YGEdgeAll) {
        setPaddingForEdge(YGEdgeLeft);
        RETURN_IF_EXCEPTION(scope, {});
        setPaddingForEdge(YGEdgeTop);
        RETURN_IF_EXCEPTION(scope, {});
        setPaddingForEdge(YGEdgeRight);
        RETURN_IF_EXCEPTION(scope, {});
        setPaddingForEdge(YGEdgeBottom);
        RETURN_IF_EXCEPTION(scope, {});
        setPaddingForEdge(YGEdgeStart);
        RETURN_IF_EXCEPTION(scope, {});
        setPaddingForEdge(YGEdgeEnd);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        setPaddingForEdge(static_cast<YGEdge>(edge));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPosition, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPosition"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setPosition requires 2 arguments (edge, value)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue valueArg = callFrame->uncheckedArgument(1);

    // Helper lambda to set position for a specific edge
    auto setPositionForEdge = [&](YGEdge targetEdge) {
        if (valueArg.isNumber()) {
            float value = static_cast<float>(valueArg.toNumber(globalObject));
            YGNodeStyleSetPosition(thisObject->internal(), targetEdge, value);
        } else if (valueArg.isString()) {
            WTF::String str = valueArg.toString(globalObject)->value(globalObject);
            
            if (str.endsWith('%')) {
                float percent = str.substring(0, str.length() - 1).toFloat();
                YGNodeStyleSetPositionPercent(thisObject->internal(), targetEdge, percent);
            } else {
                float value = str.toFloat();
                YGNodeStyleSetPosition(thisObject->internal(), targetEdge, value);
            }
        } else if (valueArg.isObject()) {
            JSC::JSObject* obj = valueArg.getObject();
            JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
            JSC::JSValue value = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
            
            int unit = unitValue.toInt32(globalObject);
            float val = static_cast<float>(value.toNumber(globalObject));
            
            if (static_cast<YGUnit>(unit) == YGUnitPercent) {
                YGNodeStyleSetPositionPercent(thisObject->internal(), targetEdge, val);
            } else {
                YGNodeStyleSetPosition(thisObject->internal(), targetEdge, val);
            }
        }
    };

    // Handle EDGE_ALL by setting all edges
    if (edge == YGEdgeAll) {
        setPositionForEdge(YGEdgeLeft);
        RETURN_IF_EXCEPTION(scope, {});
        setPositionForEdge(YGEdgeTop);
        RETURN_IF_EXCEPTION(scope, {});
        setPositionForEdge(YGEdgeRight);
        RETURN_IF_EXCEPTION(scope, {});
        setPositionForEdge(YGEdgeBottom);
        RETURN_IF_EXCEPTION(scope, {});
        setPositionForEdge(YGEdgeStart);
        RETURN_IF_EXCEPTION(scope, {});
        setPositionForEdge(YGEdgeEnd);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        setPositionForEdge(static_cast<YGEdge>(edge));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetGap, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setGap"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setGap requires 2 arguments (gutter, value)"_s);
        return {};
    }

    int gutter = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue valueArg = callFrame->uncheckedArgument(1);

    // Helper lambda to set gap for a specific gutter
    auto setGapForGutter = [&](YGGutter targetGutter) {
        if (valueArg.isNumber()) {
            float value = valueArg.toFloat(globalObject);
            YGNodeStyleSetGap(thisObject->internal(), targetGutter, value);
        } else if (valueArg.isString()) {
            String str = valueArg.toWTFString(globalObject);
            
            if (str.endsWith('%')) {
                String numberPart = str.substring(0, str.length() - 1);
                float percent = numberPart.toFloat();
                YGNodeStyleSetGapPercent(thisObject->internal(), targetGutter, percent);
            }
        } else if (valueArg.isObject()) {
            JSC::JSObject* obj = valueArg.toObject(globalObject);
            
            JSC::JSValue unitValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "unit"_s));
            JSC::JSValue valueValue = obj->get(globalObject, JSC::Identifier::fromString(vm, "value"_s));
            
            int unit = unitValue.toInt32(globalObject);
            float value = valueValue.toFloat(globalObject);
            
            if (unit == YGUnitPercent) {
                YGNodeStyleSetGapPercent(thisObject->internal(), targetGutter, value);
            } else {
                YGNodeStyleSetGap(thisObject->internal(), targetGutter, value);
            }
        }
    };

    // Handle GUTTER_ALL by setting both row and column
    if (gutter == YGGutterAll) {
        setGapForGutter(YGGutterRow);
        RETURN_IF_EXCEPTION(scope, {});
        setGapForGutter(YGGutterColumn);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        setGapForGutter(static_cast<YGGutter>(gutter));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (UNLIKELY(!thisObject->internal())) {
        throwTypeError(globalObject, scope, "Cannot perform operation on freed Yoga.Node"_s);
        return {};
    }

    YGValue value = YGNodeStyleGetWidth(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetHeight(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMinWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetMinWidth(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMinHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetMinHeight(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMaxWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetMaxWidth(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMaxHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetMaxHeight(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexBasis, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexBasis"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGValue value = YGNodeStyleGetFlexBasis(thisObject->internal());
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMargin, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMargin"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getMargin requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetMargin(thisObject->internal(), static_cast<YGEdge>(edge));
    
    // Create the return object { unit, value }
    auto* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPadding, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getPadding"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getPadding requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetPadding(thisObject->internal(), static_cast<YGEdge>(edge));
    
    // Create the return object { unit, value }
    auto* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPosition, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getPosition"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getPosition requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetPosition(thisObject->internal(), static_cast<YGEdge>(edge));
    
    // Create the return object { unit, value }
    auto* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(value.unit)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(value.value));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "insertChild"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "insertChild requires 2 arguments (child, index)"_s);
        return {};
    }

    auto* child = jsDynamicCast<JSYogaNode*>(callFrame->uncheckedArgument(0));
    if (!child) {
        throwTypeError(globalObject, scope, "First argument must be a Yoga.Node instance"_s);
        return {};
    }

    int index = callFrame->uncheckedArgument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeInsertChild(thisObject->internal(), child->internal(), index);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getChild"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getChild requires 1 argument (index)"_s);
        return {};
    }

    int index = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeRef childYGNode = YGNodeGetChild(thisObject->internal(), index);
    if (!childYGNode) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    // Get the JSYogaNode wrapper from the context
    JSYogaNode* childJSNode = JSYogaNode::fromYGNode(childYGNode);
    if (!childJSNode) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(childJSNode);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getParent"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeRef parentYGNode = YGNodeGetParent(thisObject->internal());
    if (!parentYGNode) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    // Get the JSYogaNode wrapper from the context
    JSYogaNode* parentJSNode = JSYogaNode::fromYGNode(parentYGNode);
    if (!parentJSNode) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(parentJSNode);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMeasureFunc"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue funcArg = callFrame->uncheckedArgument(0);
    
    if (funcArg.isNull() || funcArg.isUndefined()) {
        // Clear the measure function
        thisObject->m_measureFunc.clear();
        YGNodeSetMeasureFunc(thisObject->internal(), nullptr);
    } else if (funcArg.isCallable()) {
        // Set the measure function
        thisObject->m_measureFunc.set(vm, thisObject, funcArg.getObject());
        YGNodeSetMeasureFunc(thisObject->internal(), bunMeasureCallback);
    } else {
        throwTypeError(globalObject, scope, "Measure function must be a function or null"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Style setter implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetDirection, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setDirection"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t direction = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetDirection(thisObject->internal(), static_cast<YGDirection>(direction));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBorder, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setBorder"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setBorder requires 2 arguments (edge, value)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    float value = static_cast<float>(callFrame->uncheckedArgument(1).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    // Handle EDGE_ALL by setting all edges
    if (edge == YGEdgeAll) {
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeLeft, value);
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeTop, value);
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeRight, value);
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeBottom, value);
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeStart, value);
        YGNodeStyleSetBorder(thisObject->internal(), YGEdgeEnd, value);
    } else {
        YGNodeStyleSetBorder(thisObject->internal(), static_cast<YGEdge>(edge), value);
    }
    
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBoxSizing, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setBoxSizing"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t boxSizing = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetBoxSizing(thisObject->internal(), static_cast<YGBoxSizing>(boxSizing));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Style getter implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDirection, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getDirection"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGDirection direction = YGNodeStyleGetDirection(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(direction)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexDirection, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexDirection"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGFlexDirection flexDirection = YGNodeStyleGetFlexDirection(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(flexDirection)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetJustifyContent, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getJustifyContent"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGJustify justifyContent = YGNodeStyleGetJustifyContent(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(justifyContent)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignContent, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getAlignContent"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGAlign alignContent = YGNodeStyleGetAlignContent(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(alignContent)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignItems, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getAlignItems"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGAlign alignItems = YGNodeStyleGetAlignItems(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(alignItems)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAlignSelf, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getAlignSelf"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGAlign alignSelf = YGNodeStyleGetAlignSelf(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(alignSelf)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPositionType, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getPositionType"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGPositionType positionType = YGNodeStyleGetPositionType(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(positionType)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexWrap, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexWrap"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGWrap flexWrap = YGNodeStyleGetFlexWrap(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(flexWrap)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetOverflow, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getOverflow"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGOverflow overflow = YGNodeStyleGetOverflow(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(overflow)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetDisplay, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getDisplay"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGDisplay display = YGNodeStyleGetDisplay(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(display)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlex, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlex"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float flex = YGNodeStyleGetFlex(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(flex));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexGrow, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexGrow"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float flexGrow = YGNodeStyleGetFlexGrow(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(flexGrow));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexShrink, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexShrink"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float flexShrink = YGNodeStyleGetFlexShrink(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(flexShrink));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetAspectRatio, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getAspectRatio"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float aspectRatio = YGNodeStyleGetAspectRatio(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(aspectRatio));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetGap, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getGap"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getGap requires 1 argument (gutter)"_s);
        return {};
    }

    int gutter = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue gap = YGNodeStyleGetGap(thisObject->internal(), static_cast<YGGutter>(gutter));
    
    JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "value"_s), JSC::jsNumber(gap.value));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "unit"_s), JSC::jsNumber(static_cast<int>(gap.unit)));
    
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetBorder, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getBorder"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getBorder requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    float border = YGNodeStyleGetBorder(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(JSC::jsNumber(border));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetBoxSizing, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getBoxSizing"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGBoxSizing boxSizing = YGNodeStyleGetBoxSizing(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(boxSizing)));
}

// Layout getter implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedLeft, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedLeft"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float left = YGNodeLayoutGetLeft(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(left));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedTop, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedTop"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float top = YGNodeLayoutGetTop(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(top));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedRight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedRight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float right = YGNodeLayoutGetRight(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(right));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBottom, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedBottom"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float bottom = YGNodeLayoutGetBottom(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(bottom));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedWidth"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float width = YGNodeLayoutGetWidth(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(width));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedHeight"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    float height = YGNodeLayoutGetHeight(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(height));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedMargin, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedMargin"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getComputedMargin requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    float margin = YGNodeLayoutGetMargin(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(JSC::jsNumber(margin));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedBorder, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedBorder"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getComputedBorder requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    float border = YGNodeLayoutGetBorder(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(JSC::jsNumber(border));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetComputedPadding, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getComputedPadding"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getComputedPadding requires 1 argument (edge)"_s);
        return {};
    }

    int edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    float padding = YGNodeLayoutGetPadding(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(JSC::jsNumber(padding));
}

// Hierarchy method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncRemoveAllChildren, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "removeAllChildren"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeRemoveAllChildren(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetOwner, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getOwner"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeRef owner = YGNodeGetOwner(thisObject->internal());
    if (!owner) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    // Get the JS wrapper from the owner's context
    JSYogaNode* jsOwner = JSYogaNode::fromYGNode(owner);
    return JSC::JSValue::encode(jsOwner ? jsOwner : JSC::jsNull());
}

// Utility method implementations
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncFreeRecursive, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "freeRecursive"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeRef node = thisObject->internal();
    if (!node) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Clear JS wrapper references recursively using a vector as a stack
    Vector<YGNodeRef> stack;
    stack.append(node);
    
    while (!stack.isEmpty()) {
        YGNodeRef currentNode = stack.takeLast();
        if (!currentNode) continue;
        
        // Get child count before processing
        uint32_t childCount = YGNodeGetChildCount(currentNode);
        
        // Add all children to the stack for processing
        for (uint32_t i = 0; i < childCount; i++) {
            YGNodeRef childNode = YGNodeGetChild(currentNode, i);
            if (childNode) {
                stack.append(childNode);
            }
        }
        
        // Clear the JS wrapper for this node
        JSYogaNode* jsNode = JSYogaNode::fromYGNode(currentNode);
        if (jsNode) {
            jsNode->clearInternal();
        }
    }
    
    // Now free the Yoga nodes
    YGNodeFreeRecursive(node);
    
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncCopyStyle, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "copyStyle"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "copyStyle requires 1 argument (sourceNode)"_s);
        return {};
    }

    auto* sourceNode = jsDynamicCast<JSYogaNode*>(callFrame->uncheckedArgument(0));
    if (!sourceNode) {
        throwTypeError(globalObject, scope, "First argument must be a Yoga.Node"_s);
        return {};
    }

    YGNodeCopyStyle(thisObject->internal(), sourceNode->internal());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncClone, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "clone"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeRef clonedNode = YGNodeClone(thisObject->internal());
    
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSYogaNodeClassStructure.get(zigGlobalObject);
    
    // Create a new JSYogaNode wrapper for the cloned node
    JSYogaNode* jsClonedNode = JSYogaNode::create(vm, structure, nullptr);
    // Replace the internal node with the cloned one
    YGNodeFree(jsClonedNode->internal());
    jsClonedNode->setInternal(clonedNode);
    YGNodeSetContext(clonedNode, jsClonedNode);
    
    // Copy JavaScript callbacks from the original node
    if (thisObject->m_measureFunc) {
        jsClonedNode->m_measureFunc.set(vm, jsClonedNode, thisObject->m_measureFunc.get());
    }
    if (thisObject->m_dirtiedFunc) {
        jsClonedNode->m_dirtiedFunc.set(vm, jsClonedNode, thisObject->m_dirtiedFunc.get());
    }
    
    // Update context pointers for all cloned children using iterative approach
    struct NodePair {
        YGNodeRef original;
        YGNodeRef cloned;
    };
    
    Vector<NodePair> stack;
    stack.append({thisObject->internal(), clonedNode});
    
    while (!stack.isEmpty()) {
        NodePair pair = stack.takeLast();
        uint32_t childCount = YGNodeGetChildCount(pair.cloned);
        
        for (uint32_t i = 0; i < childCount; i++) {
            YGNodeRef clonedChild = YGNodeGetChild(pair.cloned, i);
            YGNodeRef originalChild = YGNodeGetChild(pair.original, i);
            
            if (clonedChild && originalChild) {
                // Create JS wrapper for cloned child
                JSYogaNode* jsClonedChild = JSYogaNode::create(vm, structure, nullptr);
                YGNodeFree(jsClonedChild->internal());
                jsClonedChild->setInternal(clonedChild);
                YGNodeSetContext(clonedChild, jsClonedChild);
                
                // Copy callbacks from original child
                JSYogaNode* jsOriginalChild = JSYogaNode::fromYGNode(originalChild);
                if (jsOriginalChild) {
                    if (jsOriginalChild->m_measureFunc) {
                        jsClonedChild->m_measureFunc.set(vm, jsClonedChild, jsOriginalChild->m_measureFunc.get());
                    }
                    if (jsOriginalChild->m_dirtiedFunc) {
                        jsClonedChild->m_dirtiedFunc.set(vm, jsClonedChild, jsOriginalChild->m_dirtiedFunc.get());
                    }
                    // Copy baseline function too
                    if (jsOriginalChild->m_baselineFunc) {
                        jsClonedChild->m_baselineFunc.set(vm, jsClonedChild, jsOriginalChild->m_baselineFunc.get());
                    }
                    // Copy config reference
                    if (jsOriginalChild->m_config) {
                        jsClonedChild->m_config.set(vm, jsClonedChild, jsOriginalChild->m_config.get());
                    }
                }
                
                // Add to stack for processing grandchildren
                stack.append({originalChild, clonedChild});
            }
        }
    }
    
    return JSC::JSValue::encode(jsClonedNode);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetNodeType, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setNodeType"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    int32_t nodeType = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeSetNodeType(thisObject->internal(), static_cast<YGNodeType>(nodeType));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetNodeType, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getNodeType"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    YGNodeType nodeType = YGNodeGetNodeType(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(nodeType)));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetIsReferenceBaseline, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setIsReferenceBaseline"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    bool isReferenceBaseline = callFrame->uncheckedArgument(0).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeSetIsReferenceBaseline(thisObject->internal(), isReferenceBaseline);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncIsReferenceBaseline, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "isReferenceBaseline"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    bool isReferenceBaseline = YGNodeIsReferenceBaseline(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(isReferenceBaseline));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetContext, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setContext"_s);
    }

    // For now, we don't support storing arbitrary JS values as context
    // The Yoga node context is used internally to store the JS wrapper
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetContext, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getContext"_s);
    }

    // Return null since we use context internally for the wrapper
    return JSC::JSValue::encode(JSC::jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetConfig, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setConfig"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue configArg = callFrame->uncheckedArgument(0);
    if (!configArg.isUndefinedOrNull()) {
        auto* jsConfig = jsDynamicCast<JSYogaConfig*>(configArg);
        if (!jsConfig) {
            throwTypeError(globalObject, scope, "First argument must be a Yoga.Config instance"_s);
            return {};
        }
        YGNodeSetConfig(thisObject->internal(), jsConfig->internal());
    } else {
        // Set to default config if null/undefined
        YGNodeSetConfig(thisObject->internal(), const_cast<YGConfigRef>(YGConfigGetDefault()));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetConfig, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getConfig"_s);
    }
    CHECK_YOGA_CONFIG_FREED(thisObject);


    // Return the stored JSYogaConfig if available
    JSC::JSValue config = thisObject->m_config.get();
    if (config) {
        return JSC::JSValue::encode(config);
    }
    
    // If no stored config, try to get it from the Yoga node
    YGConfigConstRef ygConfig = YGNodeGetConfig(thisObject->internal());
    if (!ygConfig) {
        return JSC::JSValue::encode(JSC::jsNull());
    }
    
    // We have a YGConfig but no JSYogaConfig wrapper stored
    // This can happen for nodes created without a config parameter
    // For now, return null
    return JSC::JSValue::encode(JSC::jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetHasNewLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getHasNewLayout"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    bool hasNewLayout = YGNodeGetHasNewLayout(thisObject->internal());
    return JSC::JSValue::encode(JSC::jsBoolean(hasNewLayout));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHasNewLayout, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setHasNewLayout"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    bool hasNewLayout = callFrame->uncheckedArgument(0).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeSetHasNewLayout(thisObject->internal(), hasNewLayout);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Baseline function callback
static float bunBaselineCallback(YGNodeConstRef ygNode, float width, float height)
{
    JSYogaNode* jsNode = JSYogaNode::fromYGNode(const_cast<YGNodeRef>(ygNode));
    if (!jsNode || !jsNode->m_baselineFunc) {
        return height; // Default baseline is the height
    }

    JSC::JSGlobalObject* globalObject = jsNode->globalObject();
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    // Call the JS baseline function with width and height
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(width));
    args.append(JSC::jsNumber(height));

    JSC::JSValue result = JSC::call(globalObject, jsNode->m_baselineFunc.get(), jsNode, args, "baseline function"_s);
    
    if (scope.exception()) {
        scope.clearException();
        return height; // Return default on error
    }

    // Convert result to float
    double baseline = result.toNumber(globalObject);
    if (scope.exception()) {
        scope.clearException();
        return height;
    }

    return static_cast<float>(baseline);
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetBaselineFunc, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return WebCore::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setBaselineFunc"_s);
    }
    CHECK_YOGA_NODE_FREED(thisObject);


    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue baselineValue = callFrame->uncheckedArgument(0);
    
    if (baselineValue.isNull() || baselineValue.isUndefined()) {
        // Clear the baseline function
        thisObject->m_baselineFunc.clear();
        YGNodeSetBaselineFunc(thisObject->internal(), nullptr);
    } else if (baselineValue.isCallable()) {
        // Set the baseline function
        JSC::JSObject* func = baselineValue.getObject();
        thisObject->m_baselineFunc.set(vm, thisObject, func);
        YGNodeSetBaselineFunc(thisObject->internal(), bunBaselineCallback);
    } else {
        throwTypeError(globalObject, scope, "Baseline function must be a function or null"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Functions that are already defined earlier in the file are not duplicated here

} // namespace Bun
