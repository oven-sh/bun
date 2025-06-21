#include "root.h"
#include "JSYogaNode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <yoga/Yoga.h>

namespace Bun {

// Helper function to parse value arguments (number, string, object, undefined)
static void parseYogaValue(JSC::JSGlobalObject* globalObject, JSC::JSValue arg, 
                          std::function<void(float)> setNumber,
                          std::function<void(float)> setPercent,
                          std::function<void()> setAuto,
                          std::function<void()> setUndefined,
                          std::function<void()> setMaxContent = nullptr,
                          std::function<void()> setFitContent = nullptr,
                          std::function<void()> setStretch = nullptr)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (arg.isNumber()) {
        setNumber(static_cast<float>(arg.asNumber()));
    } else if (arg.isString()) {
        auto str = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        
        if (str == "auto"_s) {
            setAuto();
        } else if (str == "max-content"_s && setMaxContent) {
            setMaxContent();
        } else if (str == "fit-content"_s && setFitContent) {
            setFitContent();
        } else if (str == "stretch"_s && setStretch) {
            setStretch();
        } else if (str.endsWith('%')) {
            // Parse percentage
            str.remove(str.length() - 1);
            float percent = str.toFloat();
            setPercent(percent);
        } else {
            throwTypeError(globalObject, scope, "Invalid string value for style property"_s);
        }
    } else if (arg.isUndefinedOrNull()) {
        setUndefined();
    } else if (arg.isObject()) {
        // Handle { unit, value } object
        JSC::JSObject* obj = arg.getObject();
        JSC::JSValue unitValue = obj->get(globalObject, vm.propertyNames->unit);
        JSC::JSValue valueValue = obj->get(globalObject, vm.propertyNames->value);
        RETURN_IF_EXCEPTION(scope, void());
        
        int32_t unit = unitValue.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        
        float value = static_cast<float>(valueValue.toNumber(globalObject));
        RETURN_IF_EXCEPTION(scope, void());
        
        switch (static_cast<YGUnit>(unit)) {
            case YGUnitPoint:
                setNumber(value);
                break;
            case YGUnitPercent:
                setPercent(value);
                break;
            case YGUnitAuto:
                setAuto();
                break;
            case YGUnitUndefined:
            default:
                setUndefined();
                break;
        }
    } else {
        throwTypeError(globalObject, scope, "Invalid value type for style property"_s);
    }
}

// Width/Height setters
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setWidth"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetWidth(node, value); },
        [node](float percent) { YGNodeStyleSetWidthPercent(node, percent); },
        [node]() { YGNodeStyleSetWidthAuto(node); },
        [node]() { YGNodeStyleSetWidth(node, YGUndefined); },
        [node]() { YGNodeStyleSetWidthMaxContent(node); },
        [node]() { YGNodeStyleSetWidthFitContent(node); },
        [node]() { YGNodeStyleSetWidthStretch(node); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setHeight"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetHeight(node, value); },
        [node](float percent) { YGNodeStyleSetHeightPercent(node, percent); },
        [node]() { YGNodeStyleSetHeightAuto(node); },
        [node]() { YGNodeStyleSetHeight(node, YGUndefined); },
        [node]() { YGNodeStyleSetHeightMaxContent(node); },
        [node]() { YGNodeStyleSetHeightFitContent(node); },
        [node]() { YGNodeStyleSetHeightStretch(node); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Edge value setters (margin, padding, position)
static void parseEdgeValue(JSC::JSGlobalObject* globalObject, YGNodeRef node, YGEdge edge, JSC::JSValue arg,
                          std::function<void(YGNodeRef, YGEdge, float)> setNumber,
                          std::function<void(YGNodeRef, YGEdge, float)> setPercent,
                          std::function<void(YGNodeRef, YGEdge)> setAuto)
{
    parseYogaValue(globalObject, arg,
        [node, edge, setNumber](float value) { setNumber(node, edge, value); },
        [node, edge, setPercent](float percent) { setPercent(node, edge, percent); },
        [node, edge, setAuto]() { if (setAuto) setAuto(node, edge); },
        [node, edge, setNumber]() { setNumber(node, edge, YGUndefined); }
    );
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMargin, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMargin"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setMargin requires 2 arguments"_s);
        return {};
    }

    YGNodeRef node = thisObject->internal();
    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    JSC::JSValue value = callFrame->uncheckedArgument(1);

    parseEdgeValue(globalObject, node, static_cast<YGEdge>(edge), value,
        YGNodeStyleSetMargin,
        YGNodeStyleSetMarginPercent,
        YGNodeStyleSetMarginAuto
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Hierarchy methods
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncInsertChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "insertChild"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "insertChild requires 2 arguments"_s);
        return {};
    }

    auto* childNode = jsDynamicCast<JSYogaNode*>(callFrame->uncheckedArgument(0));
    if (!childNode) {
        throwTypeError(globalObject, scope, "First argument must be a Yoga.Node"_s);
        return {};
    }

    int32_t index = callFrame->uncheckedArgument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeInsertChild(thisObject->internal(), childNode->internal(), index);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetChild, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getChild"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getChild requires 1 argument"_s);
        return {};
    }

    int32_t index = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeRef childRef = YGNodeGetChild(thisObject->internal(), index);
    JSYogaNode* childNode = childRef ? JSYogaNode::fromYGNode(childRef) : nullptr;
    
    return JSC::JSValue::encode(childNode ? childNode : JSC::jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetParent, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getParent"_s));
    }

    YGNodeRef parentRef = YGNodeGetParent(thisObject->internal());
    JSYogaNode* parentNode = parentRef ? JSYogaNode::fromYGNode(parentRef) : nullptr;
    
    return JSC::JSValue::encode(parentNode ? parentNode : JSC::jsNull());
}

// Measure function callback
static YGSize bunMeasureCallback(YGNodeConstRef ygNode, float width, YGMeasureMode widthMode, 
                                 float height, YGMeasureMode heightMode)
{
    JSYogaNode* jsNode = JSYogaNode::fromYGNode(const_cast<YGNodeRef>(ygNode));
    if (!jsNode || !jsNode->m_measureFunc) return { YGUndefined, YGUndefined };

    JSC::JSGlobalObject* globalObject = jsNode->globalObject();
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(width));
    args.append(JSC::jsNumber(static_cast<int>(widthMode)));
    args.append(JSC::jsNumber(height));
    args.append(JSC::jsNumber(static_cast<int>(heightMode)));

    JSC::JSValue result = JSC::call(globalObject, jsNode->m_measureFunc.get(), JSC::jsUndefined(), args);
    if (scope.exception()) { 
        scope.clearException(); 
        return { 0, 0 }; 
    }

    if (!result.isObject()) return { 0, 0 };
    
    JSC::JSObject* sizeObj = result.getObject();
    float resultWidth = sizeObj->get(globalObject, vm.propertyNames->width).toFloat(globalObject);
    float resultHeight = sizeObj->get(globalObject, vm.propertyNames->height).toFloat(globalObject);

    return { resultWidth, resultHeight };
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMeasureFunc, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMeasureFunc"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSValue func = callFrame->uncheckedArgument(0);
    if (func.isUndefinedOrNull()) {
        thisObject->m_measureFunc.clear();
        YGNodeSetMeasureFunc(thisObject->internal(), nullptr);
    } else if (func.isCallable()) {
        thisObject->m_measureFunc.set(vm, thisObject, func.getObject());
        YGNodeSetMeasureFunc(thisObject->internal(), bunMeasureCallback);
    } else {
        throwTypeError(globalObject, scope, "Measure function must be callable or null"_s);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Min/Max setters
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMinWidth"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetMinWidth(node, value); },
        [node](float percent) { YGNodeStyleSetMinWidthPercent(node, percent); },
        []() { /* no auto for min */ },
        [node]() { YGNodeStyleSetMinWidth(node, YGUndefined); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMinHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMinHeight"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetMinHeight(node, value); },
        [node](float percent) { YGNodeStyleSetMinHeightPercent(node, percent); },
        []() { /* no auto for min */ },
        [node]() { YGNodeStyleSetMinHeight(node, YGUndefined); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMaxWidth"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetMaxWidth(node, value); },
        [node](float percent) { YGNodeStyleSetMaxWidthPercent(node, percent); },
        []() { /* no auto for max */ },
        [node]() { YGNodeStyleSetMaxWidth(node, YGUndefined); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetMaxHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setMaxHeight"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetMaxHeight(node, value); },
        [node](float percent) { YGNodeStyleSetMaxHeightPercent(node, percent); },
        []() { /* no auto for max */ },
        [node]() { YGNodeStyleSetMaxHeight(node, YGUndefined); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetFlexBasis, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setFlexBasis"_s));
    }

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    YGNodeRef node = thisObject->internal();
    JSC::JSValue arg = callFrame->uncheckedArgument(0);

    parseYogaValue(globalObject, arg,
        [node](float value) { YGNodeStyleSetFlexBasis(node, value); },
        [node](float percent) { YGNodeStyleSetFlexBasisPercent(node, percent); },
        [node]() { YGNodeStyleSetFlexBasisAuto(node); },
        [node]() { YGNodeStyleSetFlexBasis(node, YGUndefined); }
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Padding setter
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPadding, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPadding"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setPadding requires 2 arguments"_s);
        return {};
    }

    YGNodeRef node = thisObject->internal();
    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    JSC::JSValue value = callFrame->uncheckedArgument(1);

    parseEdgeValue(globalObject, node, static_cast<YGEdge>(edge), value,
        YGNodeStyleSetPadding,
        YGNodeStyleSetPaddingPercent,
        nullptr // no auto for padding
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Position setter
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetPosition, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setPosition"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setPosition requires 2 arguments"_s);
        return {};
    }

    YGNodeRef node = thisObject->internal();
    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    JSC::JSValue value = callFrame->uncheckedArgument(1);

    parseEdgeValue(globalObject, node, static_cast<YGEdge>(edge), value,
        YGNodeStyleSetPosition,
        YGNodeStyleSetPositionPercent,
        nullptr // no auto for position
    );

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Gap setter
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncSetGap, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "setGap"_s));
    }

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setGap requires 2 arguments"_s);
        return {};
    }

    YGNodeRef node = thisObject->internal();
    int32_t gutter = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    float gap = static_cast<float>(callFrame->uncheckedArgument(1).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    YGNodeStyleSetGap(node, static_cast<YGGutter>(gutter), gap);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Helper to convert YGValue to JSValue
static JSC::JSValue ygValueToJS(JSC::JSGlobalObject* globalObject, YGValue value) 
{
    JSC::VM& vm = globalObject->vm();
    
    if (YGFloatIsUndefined(value.value)) {
        return JSC::jsUndefined();
    }
    
    JSC::JSObject* obj = JSC::constructEmptyObject(globalObject);
    obj->putDirect(vm, vm.propertyNames->unit, JSC::jsNumber(static_cast<int>(value.unit)));
    obj->putDirect(vm, vm.propertyNames->value, JSC::jsNumber(value.value));
    
    return obj;
}

// Style getters
JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getWidth"_s));
    }

    YGValue value = YGNodeStyleGetWidth(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getHeight"_s));
    }

    YGValue value = YGNodeStyleGetHeight(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMinWidth"_s));
    }

    YGValue value = YGNodeStyleGetMinWidth(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMinHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMinHeight"_s));
    }

    YGValue value = YGNodeStyleGetMinHeight(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxWidth, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMaxWidth"_s));
    }

    YGValue value = YGNodeStyleGetMaxWidth(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMaxHeight, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMaxHeight"_s));
    }

    YGValue value = YGNodeStyleGetMaxHeight(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetFlexBasis, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getFlexBasis"_s));
    }

    YGValue value = YGNodeStyleGetFlexBasis(thisObject->internal());
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetMargin, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getMargin"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getMargin requires 1 argument"_s);
        return {};
    }

    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetMargin(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPadding, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getPadding"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getPadding requires 1 argument"_s);
        return {};
    }

    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetPadding(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsYogaNodeProtoFuncGetPosition, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSYogaNode*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSC::JSValue::encode(Bun::throwThisTypeError(*globalObject, scope, "Yoga.Node"_s, "getPosition"_s));
    }

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getPosition requires 1 argument"_s);
        return {};
    }

    int32_t edge = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    YGValue value = YGNodeStyleGetPosition(thisObject->internal(), static_cast<YGEdge>(edge));
    return JSC::JSValue::encode(ygValueToJS(globalObject, value));
}

} // namespace Bun