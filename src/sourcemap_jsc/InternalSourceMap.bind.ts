import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::internal_jsc" });

export const fromVLQ = b.fn({
  args: { vlq: b.string.loose.utf8 },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});

export const toVLQ = b.fn({
  args: { blob: b.bytes({ from: ["buffer"] }) },
  returns: b.string.utf8,
  capability: "heap",
  throws: true,
});

export const InternalSourceMapMapping = b.dictionary({
  generatedLine: b.i32,
  generatedColumn: b.i32,
  originalLine: b.i32,
  originalColumn: b.i32,
  sourceIndex: b.i32,
});

export const find = b.fn({
  args: { blob: b.bytes({ from: ["buffer"] }), line: b.f64, col: b.f64 },
  returns: InternalSourceMapMapping.nullable,
  capability: "heap",
  throws: true,
});
