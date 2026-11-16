import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::node_assert_binding" });

/** The ANSI sequences of `internal/util/colors`, which are empty when colors are off. */
export const Colors = b.dictionary({
  green: b.string.utf8,
  red: b.string.utf8,
  white: b.string.utf8,
  blue: b.string.utf8,
});

// Once the arguments are converted, node_assert.rs compares code units and lays what it makes on new objects.
const diff = { capability: "js", throws: true, runsOnlyOperandCode: true } as const;

/** A new array of objects without a prototype, `{ kind, value }`. */
export const myersDiff = b.fn({
  ...diff,
  args: {
    actual: b.string.allowStringObject,
    expected: b.string.allowStringObject,
    checkCommaDisparity: b.bool.loose.default(false),
    lines: b.bool.loose.default(false),
  },
  returns: b.any.returning(table.instance("Array").holding({ element: table.object }).fresh.spec),
});

export const printSimpleMyersDiff = b.fn({
  ...diff,
  args: { actual: b.string.allowStringObject, expected: b.string.allowStringObject, colors: Colors },
  returns: b.any.returning("string"),
});

export const printMyersDiff = b.fn({
  ...diff,
  args: {
    actual: b.string.allowStringObject,
    expected: b.string.allowStringObject,
    checkCommaDisparity: b.bool.loose,
    colors: Colors,
  },
  returns: b.any.returning(table.ordinaryObjectOf("PrintedMyersDiff").fresh.spec),
});
