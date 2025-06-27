#include "root.h"
#include "JSYogaConstants.h"
#include <JavaScriptCore/JSCInlines.h>
#include <yoga/Yoga.h>

namespace Bun {

using namespace JSC;

const JSC::ClassInfo JSYogaConstants::s_info = { "YogaConstants"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConstants) };

void JSYogaConstants::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    // Align values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_AUTO"_s), JSC::jsNumber(static_cast<int>(YGAlignAuto)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_START"_s), JSC::jsNumber(static_cast<int>(YGAlignFlexStart)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_CENTER"_s), JSC::jsNumber(static_cast<int>(YGAlignCenter)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_FLEX_END"_s), JSC::jsNumber(static_cast<int>(YGAlignFlexEnd)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_STRETCH"_s), JSC::jsNumber(static_cast<int>(YGAlignStretch)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_BASELINE"_s), JSC::jsNumber(static_cast<int>(YGAlignBaseline)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_BETWEEN"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceBetween)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_AROUND"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceAround)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ALIGN_SPACE_EVENLY"_s), JSC::jsNumber(static_cast<int>(YGAlignSpaceEvenly)), 0);

    // Direction values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "DIRECTION_INHERIT"_s), JSC::jsNumber(static_cast<int>(YGDirectionInherit)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "DIRECTION_LTR"_s), JSC::jsNumber(static_cast<int>(YGDirectionLTR)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "DIRECTION_RTL"_s), JSC::jsNumber(static_cast<int>(YGDirectionRTL)), 0);

    // Display values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "DISPLAY_FLEX"_s), JSC::jsNumber(static_cast<int>(YGDisplayFlex)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "DISPLAY_NONE"_s), JSC::jsNumber(static_cast<int>(YGDisplayNone)), 0);

    // Edge values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_LEFT"_s), JSC::jsNumber(static_cast<int>(YGEdgeLeft)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_TOP"_s), JSC::jsNumber(static_cast<int>(YGEdgeTop)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_RIGHT"_s), JSC::jsNumber(static_cast<int>(YGEdgeRight)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_BOTTOM"_s), JSC::jsNumber(static_cast<int>(YGEdgeBottom)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_START"_s), JSC::jsNumber(static_cast<int>(YGEdgeStart)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_END"_s), JSC::jsNumber(static_cast<int>(YGEdgeEnd)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_HORIZONTAL"_s), JSC::jsNumber(static_cast<int>(YGEdgeHorizontal)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_VERTICAL"_s), JSC::jsNumber(static_cast<int>(YGEdgeVertical)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EDGE_ALL"_s), JSC::jsNumber(static_cast<int>(YGEdgeAll)), 0);

    // Experimental feature values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS"_s), JSC::jsNumber(static_cast<int>(YGExperimentalFeatureWebFlexBasis)), 0);

    // Flex direction values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionColumn)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_COLUMN_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionColumnReverse)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionRow)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "FLEX_DIRECTION_ROW_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGFlexDirectionRowReverse)), 0);

    // Gutter values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "GUTTER_COLUMN"_s), JSC::jsNumber(static_cast<int>(YGGutterColumn)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "GUTTER_ROW"_s), JSC::jsNumber(static_cast<int>(YGGutterRow)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "GUTTER_ALL"_s), JSC::jsNumber(static_cast<int>(YGGutterAll)), 0);

    // Justify values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_START"_s), JSC::jsNumber(static_cast<int>(YGJustifyFlexStart)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_CENTER"_s), JSC::jsNumber(static_cast<int>(YGJustifyCenter)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_FLEX_END"_s), JSC::jsNumber(static_cast<int>(YGJustifyFlexEnd)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_BETWEEN"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceBetween)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_AROUND"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceAround)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "JUSTIFY_SPACE_EVENLY"_s), JSC::jsNumber(static_cast<int>(YGJustifySpaceEvenly)), 0);

    // Measure mode values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_UNDEFINED"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeUndefined)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_EXACTLY"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeExactly)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "MEASURE_MODE_AT_MOST"_s), JSC::jsNumber(static_cast<int>(YGMeasureModeAtMost)), 0);

    // Node type values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_DEFAULT"_s), JSC::jsNumber(static_cast<int>(YGNodeTypeDefault)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "NODE_TYPE_TEXT"_s), JSC::jsNumber(static_cast<int>(YGNodeTypeText)), 0);

    // Overflow values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "OVERFLOW_VISIBLE"_s), JSC::jsNumber(static_cast<int>(YGOverflowVisible)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "OVERFLOW_HIDDEN"_s), JSC::jsNumber(static_cast<int>(YGOverflowHidden)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "OVERFLOW_SCROLL"_s), JSC::jsNumber(static_cast<int>(YGOverflowScroll)), 0);

    // Position type values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_STATIC"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeStatic)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_RELATIVE"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeRelative)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "POSITION_TYPE_ABSOLUTE"_s), JSC::jsNumber(static_cast<int>(YGPositionTypeAbsolute)), 0);

    // Unit values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "UNIT_UNDEFINED"_s), JSC::jsNumber(static_cast<int>(YGUnitUndefined)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "UNIT_POINT"_s), JSC::jsNumber(static_cast<int>(YGUnitPoint)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "UNIT_PERCENT"_s), JSC::jsNumber(static_cast<int>(YGUnitPercent)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "UNIT_AUTO"_s), JSC::jsNumber(static_cast<int>(YGUnitAuto)), 0);

    // Wrap values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "WRAP_NO_WRAP"_s), JSC::jsNumber(static_cast<int>(YGWrapNoWrap)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP"_s), JSC::jsNumber(static_cast<int>(YGWrapWrap)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "WRAP_WRAP_REVERSE"_s), JSC::jsNumber(static_cast<int>(YGWrapWrapReverse)), 0);

    // Errata values
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_NONE"_s), JSC::jsNumber(static_cast<int>(YGErrataNone)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_STRETCH_FLEX_BASIS"_s), JSC::jsNumber(static_cast<int>(YGErrataStretchFlexBasis)), 0);
    // YGErrataAbsolutePositioningIncorrect is not available in this version of Yoga
    // putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_POSITIONING_INCORRECT"_s), JSC::jsNumber(static_cast<int>(YGErrataAbsolutePositioningIncorrect)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE"_s), JSC::jsNumber(static_cast<int>(YGErrataAbsolutePercentAgainstInnerSize)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_ALL"_s), JSC::jsNumber(static_cast<int>(YGErrataAll)), 0);
    putDirectWithoutTransition(vm, JSC::Identifier::fromString(vm, "ERRATA_CLASSIC"_s), JSC::jsNumber(static_cast<int>(YGErrataClassic)), 0);
}

} // namespace Bun
