import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bytecode_order_recorder" });

export const BytecodeOrderTextKind = b.enumeration(["module", "script", "builtin", "internal"]);

/** `unknown`: no internal module has that specifier. `unnamed`: the text does not parse. */
export const BytecodeOrderNames = b.union({ unknown: b.undefined, unnamed: b.null, lines: b.string.utf8 });

export const namesForTesting = b.fn({
  args: { text: b.string.loose.utf8, kind: BytecodeOrderTextKind, chunkPaths: b.string.loose.utf8.optional },
  returns: BytecodeOrderNames,
  length: 3,
});
