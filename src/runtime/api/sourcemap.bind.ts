import * as b from "../../codegen/bindgen-lib.ts";

const find = { returns: b.any, capability: "js", throws: true } as const;

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
