import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_source_map" });

const find = { returns: b.object, capability: "js", throws: true } as const;

/** `ToInt32`, and the low 32 bits of a BigInt. */
export const SourcePosition = b.union({ bigint: b.bigInt, number: b.i32.wrap });

/** `undefined`, `null` and `false` are no string. Anything else but a symbol is converted to one. */
export const SourceMapMappings = b.union({
  absent: b.null,
  flag: b.bool,
  symbol: b.symbol,
  text: b.string.loose,
});
/** The elements of `sources` are converted before `names` is read. */
export const SourceMapPayload = b.dictionary(
  {
    mappings: SourceMapMappings,
    sources: { type: b.jsArray.nullable, expected: "sources must be an array" },
    names: { type: b.jsArray.nullable, expected: "names must be an array" },
  },
  { deferred: true },
);
/** Read once `payload` is known not to be an array. */
export const SourceMapOptions = b.dictionary({ lineLengths: b.jsArray.otherAsNull }, { deferred: true });

export const SourceMap = b.class({
  rustPath: "crate::api::js_source_map::JSSourceMap",
  estimatedSize: true,
  construct: {
    passStructure: true,
    args: { payload: SourceMapPayload, options: SourceMapOptions.otherAsNull },
    expected: { payload: ["object"] },
    capability: "js",
    throws: true,
    length: 0,
  },
  internalFields: ["lineLengths", "payload"],
  proto: {
    findEntry: { ...find, args: { lineOffset: SourcePosition, columnOffset: SourcePosition } },
    findOrigin: { ...find, args: { lineNumber: SourcePosition, columnNumber: SourcePosition } },
    lineLengths: { internalField: "lineLengths" },
    payload: { internalField: "payload" },
  },
});

/** Returns before it looks at `path`: source maps are not enabled. */
export const findSourceMap = b.fn({
  args: { path: b.string.allowStringObject.otherAsNull.deferred },
  length: 1,
  returns: SourceMap.optional,
  capability: "js",
  throws: true,
});
