#include "root.h"
#include "JSYogaConstants.h"
#include <JavaScriptCore/JSCInlines.h>
#include <yoga/Yoga.h>

namespace Bun {

const JSC::ClassInfo JSYogaConstants::s_info = { "YogaConstants"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConstants) };

void JSYogaConstants::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    
    // Align values
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_AUTO"_s), JSC::jsNumber(YGAlignAuto), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_START"_s), JSC::jsNumber(YGAlignFlexStart), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_CENTER"_s), JSC::jsNumber(YGAlignCenter), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_END"_s), JSC::jsNumber(YGAlignFlexEnd), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_STRETCH"_s), JSC::jsNumber(YGAlignStretch), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_BASELINE"_s), JSC::jsNumber(YGAlignBaseline), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_BETWEEN"_s), JSC::jsNumber(YGAlignSpaceBetween), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_AROUND"_s), JSC::jsNumber(YGAlignSpaceAround), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_EVENLY"_s), JSC::jsNumber(YGAlignSpaceEvenly), 0);
    
    // Direction values
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_INHERIT"_s), JSC::jsNumber(YGDirectionInherit), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_LTR"_s), JSC::jsNumber(YGDirectionLTR), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DIRECTION_RTL"_s), JSC::jsNumber(YGDirectionRTL), 0);
    
    // Display values
    putDirect(vm, JSC::Identifier::fromString(vm, "DISPLAY_FLEX"_s), JSC::jsNumber(YGDisplayFlex), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "DISPLAY_NONE"_s), JSC::jsNumber(YGDisplayNone), 0);
    
    // Edge values
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_LEFT"_s), JSC::jsNumber(YGEdgeLeft), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_TOP"_s), JSC::jsNumber(YGEdgeTop), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_RIGHT"_s), JSC::jsNumber(YGEdgeRight), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_BOTTOM"_s), JSC::jsNumber(YGEdgeBottom), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_START"_s), JSC::jsNumber(YGEdgeStart), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_END"_s), JSC::jsNumber(YGEdgeEnd), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_HORIZONTAL"_s), JSC::jsNumber(YGEdgeHorizontal), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_VERTICAL"_s), JSC::jsNumber(YGEdgeVertical), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EDGE_ALL"_s), JSC::jsNumber(YGEdgeAll), 0);
    
    // Experimental feature values
    putDirect(vm, JSC::Identifier::fromString(vm, "EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS"_s), JSC::jsNumber(YGExperimentalFeatureWebFlexBasis), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EXPERIMENTAL_FEATURE_ABSOLUTE_PERCENTAGE_AGAINST_PADDING_EDGE"_s), JSC::jsNumber(YGExperimentalFeatureAbsolutePercentageAgainstPaddingEdge), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "EXPERIMENTAL_FEATURE_FIX_ABSOLUTE_TRAILING_COLUMN_MARGIN"_s), JSC::jsNumber(YGExperimentalFeatureFixAbsoluteTrailingColumnMargin), 0);
    
    // Flex direction values
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN"_s), JSC::jsNumber(YGFlexDirectionColumn), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN_REVERSE"_s), JSC::jsNumber(YGFlexDirectionColumnReverse), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW"_s), JSC::jsNumber(YGFlexDirectionRow), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW_REVERSE"_s), JSC::jsNumber(YGFlexDirectionRowReverse), 0);
    
    // Gutter values
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_COLUMN"_s), JSC::jsNumber(YGGutterColumn), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_ROW"_s), JSC::jsNumber(YGGutterRow), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "GUTTER_ALL"_s), JSC::jsNumber(YGGutterAll), 0);
    
    // Justify values
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_START"_s), JSC::jsNumber(YGJustifyFlexStart), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_CENTER"_s), JSC::jsNumber(YGJustifyCenter), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_END"_s), JSC::jsNumber(YGJustifyFlexEnd), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_BETWEEN"_s), JSC::jsNumber(YGJustifySpaceBetween), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_AROUND"_s), JSC::jsNumber(YGJustifySpaceAround), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_EVENLY"_s), JSC::jsNumber(YGJustifySpaceEvenly), 0);
    
    // Measure mode values
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_UNDEFINED"_s), JSC::jsNumber(YGMeasureModeUndefined), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_EXACTLY"_s), JSC::jsNumber(YGMeasureModeExactly), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_AT_MOST"_s), JSC::jsNumber(YGMeasureModeAtMost), 0);
    
    // Node type values
    putDirect(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_DEFAULT"_s), JSC::jsNumber(YGNodeTypeDefault), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_TEXT"_s), JSC::jsNumber(YGNodeTypeText), 0);
    
    // Overflow values
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_VISIBLE"_s), JSC::jsNumber(YGOverflowVisible), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_HIDDEN"_s), JSC::jsNumber(YGOverflowHidden), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "OVERFLOW_SCROLL"_s), JSC::jsNumber(YGOverflowScroll), 0);
    
    // Position type values
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_STATIC"_s), JSC::jsNumber(YGPositionTypeStatic), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_RELATIVE"_s), JSC::jsNumber(YGPositionTypeRelative), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_ABSOLUTE"_s), JSC::jsNumber(YGPositionTypeAbsolute), 0);
    
    // Unit values
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_UNDEFINED"_s), JSC::jsNumber(YGUnitUndefined), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_POINT"_s), JSC::jsNumber(YGUnitPoint), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_PERCENT"_s), JSC::jsNumber(YGUnitPercent), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "UNIT_AUTO"_s), JSC::jsNumber(YGUnitAuto), 0);
    
    // Wrap values
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_NO_WRAP"_s), JSC::jsNumber(YGWrapNoWrap), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP"_s), JSC::jsNumber(YGWrapWrap), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP_REVERSE"_s), JSC::jsNumber(YGWrapWrapReverse), 0);
    
    // Errata values
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_NONE"_s), JSC::jsNumber(YGErrataNone), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_STRETCH_FLEX_BASIS"_s), JSC::jsNumber(YGErrataStretchFlexBasis), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_POSITIONING_INCORRECT"_s), JSC::jsNumber(YGErrataAbsolutePositioningIncorrect), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE"_s), JSC::jsNumber(YGErrataAbsolutePercentAgainstInnerSize), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_ALL"_s), JSC::jsNumber(YGErrataAll), 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "ERRATA_CLASSIC"_s), JSC::jsNumber(YGErrataClassic), 0);
}

} // namespace Bun