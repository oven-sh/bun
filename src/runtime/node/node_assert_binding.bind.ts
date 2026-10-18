import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_assert_binding" });

/** `internal/util/colors` */
export const Colors = b.dictionary({
  green: b.string.utf8,
  red: b.string.utf8,
  white: b.string.utf8,
  blue: b.string.utf8,
});

export const myersDiff = b.fn({
  args: {
    actual: b.string.allowStringObject,
    expected: b.string.allowStringObject,
    checkCommaDisparity: b.bool.loose.default(false),
    lines: b.bool.loose.default(false),
  },
  returns: b.any,
  capability: "js",
  throws: true,
});
/** Diffs by char and renders the `printSimpleMyersDiff` string. */
export const printSimpleMyersDiff = b.fn({
  args: { actual: b.string.allowStringObject, expected: b.string.allowStringObject, colors: Colors },
  returns: b.any,
  capability: "js",
  throws: true,
});
/** Diffs by line and renders the `printMyersDiff` message, collapsing long unchanged runs. */
export const printMyersDiff = b.fn({
  args: {
    actual: b.string.allowStringObject,
    expected: b.string.allowStringObject,
    checkCommaDisparity: b.bool.loose,
    colors: Colors,
  },
  returns: b.any,
  capability: "js",
  throws: true,
});
