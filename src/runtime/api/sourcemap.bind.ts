import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_source_map" });

const find = { returns: b.object, capability: "js", throws: true } as const;

/** Node.js does no validations. */
const position = b.i32.allowBigInt.wrap;

export const SourceMap = b.class({
  rustPath: "crate::api::js_source_map::JSSourceMap",
  estimatedSize: true,
  construct: {
    passStructure: true,
    args: { payload: b.opaque, options: b.opaque },
    capability: "js",
    throws: true,
    length: 0,
  },
  internalFields: ["lineLengths", "payload"],
  proto: {
    findEntry: { ...find, args: { lineOffset: position, columnOffset: position } },
    findOrigin: { ...find, args: { lineNumber: position, columnNumber: position } },
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
