#include "root.h"
#include "JSYogaModule.h"
#include "JSYogaConstructor.h"
#include "JSYogaPrototype.h"
#include <yoga/Yoga.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

static const HashTableValue JSYogaModuleTableValues[] = {
    // Align values
    { "ALIGN_AUTO"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignAuto) } },
    { "ALIGN_FLEX_START"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignFlexStart) } },
    { "ALIGN_CENTER"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignCenter) } },
    { "ALIGN_FLEX_END"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignFlexEnd) } },
    { "ALIGN_STRETCH"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignStretch) } },
    { "ALIGN_BASELINE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignBaseline) } },
    { "ALIGN_SPACE_BETWEEN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignSpaceBetween) } },
    { "ALIGN_SPACE_AROUND"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignSpaceAround) } },
    { "ALIGN_SPACE_EVENLY"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGAlignSpaceEvenly) } },

    // Box sizing values
    { "BOX_SIZING_BORDER_BOX"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGBoxSizingBorderBox) } },
    { "BOX_SIZING_CONTENT_BOX"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGBoxSizingContentBox) } },

    // Dimension values
    { "DIMENSION_WIDTH"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDimensionWidth) } },
    { "DIMENSION_HEIGHT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDimensionHeight) } },

    // Direction values
    { "DIRECTION_INHERIT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDirectionInherit) } },
    { "DIRECTION_LTR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDirectionLTR) } },
    { "DIRECTION_RTL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDirectionRTL) } },

    // Display values
    { "DISPLAY_FLEX"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDisplayFlex) } },
    { "DISPLAY_NONE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDisplayNone) } },
    { "DISPLAY_CONTENTS"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGDisplayContents) } },

    // Edge values
    { "EDGE_LEFT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeLeft) } },
    { "EDGE_TOP"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeTop) } },
    { "EDGE_RIGHT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeRight) } },
    { "EDGE_BOTTOM"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeBottom) } },
    { "EDGE_START"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeStart) } },
    { "EDGE_END"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeEnd) } },
    { "EDGE_HORIZONTAL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeHorizontal) } },
    { "EDGE_VERTICAL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeVertical) } },
    { "EDGE_ALL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGEdgeAll) } },

    // Errata values
    { "ERRATA_NONE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataNone) } },
    { "ERRATA_STRETCH_FLEX_BASIS"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataStretchFlexBasis) } },
    { "ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataAbsolutePositionWithoutInsetsExcludesPadding) } },
    { "ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataAbsolutePercentAgainstInnerSize) } },
    { "ERRATA_ALL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataAll) } },
    { "ERRATA_CLASSIC"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGErrataClassic) } },

    // Experimental feature values
    { "EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGExperimentalFeatureWebFlexBasis) } },

    // Flex direction values
    { "FLEX_DIRECTION_COLUMN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGFlexDirectionColumn) } },
    { "FLEX_DIRECTION_COLUMN_REVERSE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGFlexDirectionColumnReverse) } },
    { "FLEX_DIRECTION_ROW"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGFlexDirectionRow) } },
    { "FLEX_DIRECTION_ROW_REVERSE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGFlexDirectionRowReverse) } },

    // Gutter values
    { "GUTTER_COLUMN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGGutterColumn) } },
    { "GUTTER_ROW"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGGutterRow) } },
    { "GUTTER_ALL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGGutterAll) } },

    // Justify values
    { "JUSTIFY_FLEX_START"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifyFlexStart) } },
    { "JUSTIFY_CENTER"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifyCenter) } },
    { "JUSTIFY_FLEX_END"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifyFlexEnd) } },
    { "JUSTIFY_SPACE_BETWEEN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifySpaceBetween) } },
    { "JUSTIFY_SPACE_AROUND"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifySpaceAround) } },
    { "JUSTIFY_SPACE_EVENLY"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGJustifySpaceEvenly) } },

    // Log level values
    { "LOG_LEVEL_ERROR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelError) } },
    { "LOG_LEVEL_WARN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelWarn) } },
    { "LOG_LEVEL_INFO"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelInfo) } },
    { "LOG_LEVEL_DEBUG"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelDebug) } },
    { "LOG_LEVEL_VERBOSE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelVerbose) } },
    { "LOG_LEVEL_FATAL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGLogLevelFatal) } },

    // Measure mode values
    { "MEASURE_MODE_UNDEFINED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGMeasureModeUndefined) } },
    { "MEASURE_MODE_EXACTLY"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGMeasureModeExactly) } },
    { "MEASURE_MODE_AT_MOST"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGMeasureModeAtMost) } },

    // Node type values
    { "NODE_TYPE_DEFAULT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGNodeTypeDefault) } },
    { "NODE_TYPE_TEXT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGNodeTypeText) } },

    // Overflow values
    { "OVERFLOW_VISIBLE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGOverflowVisible) } },
    { "OVERFLOW_HIDDEN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGOverflowHidden) } },
    { "OVERFLOW_SCROLL"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGOverflowScroll) } },

    // Position type values
    { "POSITION_TYPE_STATIC"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGPositionTypeStatic) } },
    { "POSITION_TYPE_RELATIVE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGPositionTypeRelative) } },
    { "POSITION_TYPE_ABSOLUTE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGPositionTypeAbsolute) } },

    // Unit values
    { "UNIT_UNDEFINED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitUndefined) } },
    { "UNIT_POINT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitPoint) } },
    { "UNIT_PERCENT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitPercent) } },
    { "UNIT_AUTO"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitAuto) } },
    { "UNIT_MAX_CONTENT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitMaxContent) } },
    { "UNIT_FIT_CONTENT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitFitContent) } },
    { "UNIT_STRETCH"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGUnitStretch) } },

    // Wrap values
    { "WRAP_NO_WRAP"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGWrapNoWrap) } },
    { "WRAP_WRAP"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGWrapWrap) } },
    { "WRAP_WRAP_REVERSE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, static_cast<int>(YGWrapWrapReverse) } },
};

const JSC::ClassInfo JSYogaModule::s_info = { "Yoga"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaModule) };

JSYogaModule* JSYogaModule::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSYogaModule* module = new (NotNull, allocateCell<JSYogaModule>(vm)) JSYogaModule(vm, structure);
    module->finishCreation(vm, globalObject);
    return module;
}

void JSYogaModule::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    // Create Config constructor and prototype
    auto* configPrototype = JSYogaConfigPrototype::create(vm, globalObject,
        JSYogaConfigPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    auto* configConstructor = JSYogaConfigConstructor::create(vm,
        JSYogaConfigConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()),
        configPrototype);

    // Set constructor property on prototype
    configPrototype->setConstructor(vm, configConstructor);

    // Create Node constructor and prototype
    auto* nodePrototype = JSYogaNodePrototype::create(vm, globalObject,
        JSYogaNodePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    auto* nodeConstructor = JSYogaNodeConstructor::create(vm,
        JSYogaNodeConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()),
        nodePrototype);

    // Set constructor property on prototype
    nodePrototype->setConstructor(vm, nodeConstructor);

    // Add constructors to module
    putDirect(vm, JSC::Identifier::fromString(vm, "Config"_s), configConstructor, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirect(vm, JSC::Identifier::fromString(vm, "Node"_s), nodeConstructor, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    // Add all Yoga constants via static hash table
    reifyStaticProperties(vm, JSYogaModule::info(), JSYogaModuleTableValues, *this);
}

// Export function for Zig integration
extern "C" JSC::EncodedJSValue Bun__createYogaModule(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    auto* structure = globalObject->JSYogaModuleStructure();
    auto* module = JSYogaModule::create(vm, globalObject, structure);
    return JSC::JSValue::encode(module);
}

} // namespace Bun
