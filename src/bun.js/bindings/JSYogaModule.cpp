#include "root.h"
#include "JSYogaModule.h"
#include "JSYogaConstructor.h"
#include "JSYogaPrototype.h"
#include <yoga/Yoga.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

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

    // Add constants
    // Align values
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_AUTO"_s), JSC::jsNumber(static_cast<int>(YGAlignAuto)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_START"_s), JSC::jsNumber(static_cast<int>(YGAlignFlexStart)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_CENTER"_s), JSC::jsNumber(static_cast<int>(YGAlignCenter)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_END"_s), JSC::jsNumber(static_cast<int>(YGAlignFlexEnd)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_STRETCH"_s), JSC::jsNumber(static_cast<int>(YGAlignStretch)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_BASELINE"_s), JSC::jsNumber(static_cast<int>(YGAlignBaseline)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_BETWEEN"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceBetween)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_AROUND"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceAround)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_EVENLY"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceEvenly)), 0);
    
    // Box sizing values
    putDirect(vm, JSC::Identifier::fromString(vm, "BOX_SIZING_BORDER_BOX"_s), JSC::jsNumber(static_cast<int>(YGBoxSizingBorderBox)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "BOX_SIZING_CONTENT_BOX"_s), JSC::jsNumber(static_cast<int>(YGBoxSizingContentBox)), 0);
    
    // Dimension values
    putDirect(vm, JSC::Identifier::fromString(vm, "DIMENSION_WIDTH"_s), JSC::jsNumber(static_cast<int>(YGDimensionWidth)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DIMENSION_HEIGHT"_s), JSC::jsNumber(static_cast<int>(YGDimensionHeight)), 0);
    
    // Direction values
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_INHERIT"_s), JSC::jsNumber(static_cast<int>(YGDirectionInherit)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_LTR"_s), JSC::jsNumber(static_cast<int>(YGDirectionLTR)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_RTL"_s), JSC::jsNumber(static_cast<int>(YGDirectionRTL)), 0);
    
    // Display values
    putDirect(vm, JSC::Identifier::fromString(vm, "DISPLAY_FLEX"_s), JSC::jsNumber(static_cast<int>(YGDisplayFlex)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DISPLAY_NONE"_s), JSC::jsNumber(static_cast<int>(YGDisplayNone)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DISPLAY_CONTENTS"_s), JSC::jsNumber(static_cast<int>(YGDisplayContents)), 0);
    
    // Edge values
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_LEFT"_s), JSC::jsNumber(static_cast<int>(YGEdgeLeft)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_TOP"_s), JSC::jsNumber(static_cast<int>(YGEdgeTop)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_RIGHT"_s), JSC::jsNumber(static_cast<int>(YGEdgeRight)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_BOTTOM"_s), JSC::jsNumber(static_cast<int>(YGEdgeBottom)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_START"_s), JSC::jsNumber(static_cast<int>(YGEdgeStart)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_END"_s), JSC::jsNumber(static_cast<int>(YGEdgeEnd)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_HORIZONTAL"_s), JSC::jsNumber(static_cast<int>(YGEdgeHorizontal)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_VERTICAL"_s), JSC::jsNumber(static_cast<int>(YGEdgeVertical)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_ALL"_s), JSC::jsNumber(static_cast<int>(YGEdgeAll)), 0);
    
    // Errata values
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_NONE"_s), JSC::jsNumber(static_cast<int>(YGErrataNone)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_STRETCH_FLEX_BASIS"_s), JSC::jsNumber(static_cast<int>(YGErrataStretchFlexBasis)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING"_s), JSC::jsNumber(static_cast<int>(YGErrataAbsolutePositionWithoutInsetsExcludesPadding)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE"_s), JSC::jsNumber(static_cast<int>(YGErrataAbsolutePercentAgainstInnerSize)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ALL"_s), JSC::jsNumber(static_cast<int>(YGErrataAll)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_CLASSIC"_s), JSC::jsNumber(static_cast<int>(YGErrataClassic)), 0);
    
    // Experimental feature values
    putDirect(vm, JSC::Identifier::fromString(vm, "EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS"_s), JSC::jsNumber(static_cast<int>(YGExperimentalFeatureWebFlexBasis)), 0);
    
    // Flex direction values
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionColumn)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionColumnReverse)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionRow)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionRowReverse)), 0);
    
    // Gutter values
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_COLUMN"_s), JSC::jsNumber(static_cast<int>(YGGutterColumn)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_ROW"_s), JSC::jsNumber(static_cast<int>(YGGutterRow)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_ALL"_s), JSC::jsNumber(static_cast<int>(YGGutterAll)), 0);
    
    // Justify values
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_START"_s), JSC::jsNumber(static_cast<int>(YGJustifyFlexStart)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_CENTER"_s), JSC::jsNumber(static_cast<int>(YGJustifyCenter)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_END"_s), JSC::jsNumber(static_cast<int>(YGJustifyFlexEnd)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_BETWEEN"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceBetween)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_AROUND"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceAround)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_EVENLY"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceEvenly)), 0);
    
    // Log level values
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_ERROR"_s), JSC::jsNumber(static_cast<int>(YGLogLevelError)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_WARN"_s), JSC::jsNumber(static_cast<int>(YGLogLevelWarn)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_INFO"_s), JSC::jsNumber(static_cast<int>(YGLogLevelInfo)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_DEBUG"_s), JSC::jsNumber(static_cast<int>(YGLogLevelDebug)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_VERBOSE"_s), JSC::jsNumber(static_cast<int>(YGLogLevelVerbose)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "LOG_LEVEL_FATAL"_s), JSC::jsNumber(static_cast<int>(YGLogLevelFatal)), 0);
    
    // Measure mode values
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_UNDEFINED"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeUndefined)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_EXACTLY"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeExactly)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_AT_MOST"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeAtMost)), 0);
    
    // Node type values
    putDirect(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_DEFAULT"_s), JSC::jsNumber(static_cast<int>(YGNodeTypeDefault)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_TEXT"_s), JSC::jsNumber(static_cast<int>(YGNodeTypeText)), 0);
    
    // Overflow values
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_VISIBLE"_s), JSC::jsNumber(static_cast<int>(YGOverflowVisible)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_HIDDEN"_s), JSC::jsNumber(static_cast<int>(YGOverflowHidden)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_SCROLL"_s), JSC::jsNumber(static_cast<int>(YGOverflowScroll)), 0);
    
    // Position type values
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_STATIC"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeStatic)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_RELATIVE"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeRelative)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_ABSOLUTE"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeAbsolute)), 0);
    
    // Unit values
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_UNDEFINED"_s), JSC::jsNumber(static_cast<int>(YGUnitUndefined)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_POINT"_s), JSC::jsNumber(static_cast<int>(YGUnitPoint)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_PERCENT"_s), JSC::jsNumber(static_cast<int>(YGUnitPercent)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_AUTO"_s), JSC::jsNumber(static_cast<int>(YGUnitAuto)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_MAX_CONTENT"_s), JSC::jsNumber(static_cast<int>(YGUnitMaxContent)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_FIT_CONTENT"_s), JSC::jsNumber(static_cast<int>(YGUnitFitContent)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_STRETCH"_s), JSC::jsNumber(static_cast<int>(YGUnitStretch)), 0);
    
    // Wrap values
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_NO_WRAP"_s), JSC::jsNumber(static_cast<int>(YGWrapNoWrap)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP"_s), JSC::jsNumber(static_cast<int>(YGWrapWrap)), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGWrapWrapReverse)), 0);
}

// Export function for Zig integration
extern "C" JSC::EncodedJSValue Bun__createYogaModule(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    auto* structure = JSYogaModule::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* module = JSYogaModule::create(vm, globalObject, structure);
    return JSC::JSValue::encode(module);
}

} // namespace Bun
