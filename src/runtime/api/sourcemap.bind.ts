import * as b from "../../codegen/bindgen-lib.ts";

const find = {
  args: { lineNumber: b.any, columnNumber: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
} as const;

export const SourceMap = b.class({
  rustPath: "crate::api::js_source_map::JSSourceMap",
  configurable: false,
  construct: {
    passStructure: true,
    args: { payload: b.any, options: b.any },
    capability: "js",
    throws: true,
    length: 0,
  },
  estimatedSize: true,
  internalFields: ["lineLengths", "payload"],
  proto: {
    findEntry: find,
    findOrigin: find,
    lineLengths: { internalField: "lineLengths" },
    payload: { internalField: "payload" },
  },
});
