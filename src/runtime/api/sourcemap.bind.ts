import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_source_map" });

const find = { returns: b.any.returning("object"), capability: "js", throws: true } as const;

export const SourceMap = b.class({
  rustPath: "crate::api::js_source_map::JSSourceMap",
  estimatedSize: true,
  construct: {
    passStructure: true,
    args: { payload: b.any, options: b.any },
    capability: "js",
    throws: true,
    length: 0,
  },
  internalFields: ["lineLengths", "payload"],
  proto: {
    findEntry: { ...find, args: { lineOffset: b.any, columnOffset: b.any } },
    findOrigin: { ...find, args: { lineNumber: b.any, columnNumber: b.any } },
    lineLengths: { internalField: "lineLengths" },
    payload: { internalField: "payload" },
  },
});

/** The own source map of a module that loaded while `process.sourceMapsEnabled` was on. `path` is not converted: what is no string has none. */
export const findSourceMap = b.fn({
  args: { path: b.any },
  returns: SourceMap.optional,
  capability: "js",
  throws: true,
});
