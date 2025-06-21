// Native Yoga layout engine bindings
// Compatible with yoga-layout API

// The native Yoga object is exposed globally
const YogaNative = globalThis.Yoga;

// Re-export everything from the native module
export const Config = YogaNative.Config;
export const Node = YogaNative.Node;

// Export all constants
export const ALIGN_AUTO = YogaNative.ALIGN_AUTO;
export const ALIGN_FLEX_START = YogaNative.ALIGN_FLEX_START;
export const ALIGN_CENTER = YogaNative.ALIGN_CENTER;
export const ALIGN_FLEX_END = YogaNative.ALIGN_FLEX_END;
export const ALIGN_STRETCH = YogaNative.ALIGN_STRETCH;
export const ALIGN_BASELINE = YogaNative.ALIGN_BASELINE;
export const ALIGN_SPACE_BETWEEN = YogaNative.ALIGN_SPACE_BETWEEN;
export const ALIGN_SPACE_AROUND = YogaNative.ALIGN_SPACE_AROUND;
export const ALIGN_SPACE_EVENLY = YogaNative.ALIGN_SPACE_EVENLY;

export const DIRECTION_INHERIT = YogaNative.DIRECTION_INHERIT;
export const DIRECTION_LTR = YogaNative.DIRECTION_LTR;
export const DIRECTION_RTL = YogaNative.DIRECTION_RTL;

export const DISPLAY_FLEX = YogaNative.DISPLAY_FLEX;
export const DISPLAY_NONE = YogaNative.DISPLAY_NONE;

export const EDGE_LEFT = YogaNative.EDGE_LEFT;
export const EDGE_TOP = YogaNative.EDGE_TOP;
export const EDGE_RIGHT = YogaNative.EDGE_RIGHT;
export const EDGE_BOTTOM = YogaNative.EDGE_BOTTOM;
export const EDGE_START = YogaNative.EDGE_START;
export const EDGE_END = YogaNative.EDGE_END;
export const EDGE_HORIZONTAL = YogaNative.EDGE_HORIZONTAL;
export const EDGE_VERTICAL = YogaNative.EDGE_VERTICAL;
export const EDGE_ALL = YogaNative.EDGE_ALL;

export const EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS = YogaNative.EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS;
export const EXPERIMENTAL_FEATURE_ABSOLUTE_PERCENTAGE_AGAINST_PADDING_EDGE = YogaNative.EXPERIMENTAL_FEATURE_ABSOLUTE_PERCENTAGE_AGAINST_PADDING_EDGE;
export const EXPERIMENTAL_FEATURE_FIX_ABSOLUTE_TRAILING_COLUMN_MARGIN = YogaNative.EXPERIMENTAL_FEATURE_FIX_ABSOLUTE_TRAILING_COLUMN_MARGIN;

export const FLEX_DIRECTION_COLUMN = YogaNative.FLEX_DIRECTION_COLUMN;
export const FLEX_DIRECTION_COLUMN_REVERSE = YogaNative.FLEX_DIRECTION_COLUMN_REVERSE;
export const FLEX_DIRECTION_ROW = YogaNative.FLEX_DIRECTION_ROW;
export const FLEX_DIRECTION_ROW_REVERSE = YogaNative.FLEX_DIRECTION_ROW_REVERSE;

export const GUTTER_COLUMN = YogaNative.GUTTER_COLUMN;
export const GUTTER_ROW = YogaNative.GUTTER_ROW;
export const GUTTER_ALL = YogaNative.GUTTER_ALL;

export const JUSTIFY_FLEX_START = YogaNative.JUSTIFY_FLEX_START;
export const JUSTIFY_CENTER = YogaNative.JUSTIFY_CENTER;
export const JUSTIFY_FLEX_END = YogaNative.JUSTIFY_FLEX_END;
export const JUSTIFY_SPACE_BETWEEN = YogaNative.JUSTIFY_SPACE_BETWEEN;
export const JUSTIFY_SPACE_AROUND = YogaNative.JUSTIFY_SPACE_AROUND;
export const JUSTIFY_SPACE_EVENLY = YogaNative.JUSTIFY_SPACE_EVENLY;

export const MEASURE_MODE_UNDEFINED = YogaNative.MEASURE_MODE_UNDEFINED;
export const MEASURE_MODE_EXACTLY = YogaNative.MEASURE_MODE_EXACTLY;
export const MEASURE_MODE_AT_MOST = YogaNative.MEASURE_MODE_AT_MOST;

export const NODE_TYPE_DEFAULT = YogaNative.NODE_TYPE_DEFAULT;
export const NODE_TYPE_TEXT = YogaNative.NODE_TYPE_TEXT;

export const OVERFLOW_VISIBLE = YogaNative.OVERFLOW_VISIBLE;
export const OVERFLOW_HIDDEN = YogaNative.OVERFLOW_HIDDEN;
export const OVERFLOW_SCROLL = YogaNative.OVERFLOW_SCROLL;

export const POSITION_TYPE_STATIC = YogaNative.POSITION_TYPE_STATIC;
export const POSITION_TYPE_RELATIVE = YogaNative.POSITION_TYPE_RELATIVE;
export const POSITION_TYPE_ABSOLUTE = YogaNative.POSITION_TYPE_ABSOLUTE;

export const UNIT_UNDEFINED = YogaNative.UNIT_UNDEFINED;
export const UNIT_POINT = YogaNative.UNIT_POINT;
export const UNIT_PERCENT = YogaNative.UNIT_PERCENT;
export const UNIT_AUTO = YogaNative.UNIT_AUTO;

export const WRAP_NO_WRAP = YogaNative.WRAP_NO_WRAP;
export const WRAP_WRAP = YogaNative.WRAP_WRAP;
export const WRAP_WRAP_REVERSE = YogaNative.WRAP_WRAP_REVERSE;

export const ERRATA_NONE = YogaNative.ERRATA_NONE;
export const ERRATA_STRETCH_FLEX_BASIS = YogaNative.ERRATA_STRETCH_FLEX_BASIS;
export const ERRATA_ABSOLUTE_POSITIONING_INCORRECT = YogaNative.ERRATA_ABSOLUTE_POSITIONING_INCORRECT;
export const ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE = YogaNative.ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE;
export const ERRATA_ALL = YogaNative.ERRATA_ALL;
export const ERRATA_CLASSIC = YogaNative.ERRATA_CLASSIC;

// Default export for compatibility
export default YogaNative;