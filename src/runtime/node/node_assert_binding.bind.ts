import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_assert_binding" });

/** The ANSI sequences of `internal/util/colors`, which are empty when colors are off. */
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

export const printSimpleMyersDiff = b.fn({
  args: { actual: b.string.allowStringObject, expected: b.string.allowStringObject, colors: Colors },
  returns: b.any,
  capability: "js",
  throws: true,
});

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
