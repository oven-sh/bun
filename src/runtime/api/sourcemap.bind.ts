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
  proto: {
    findEntry: { ...find, args: { lineOffset: b.any, columnOffset: b.any } },
    findOrigin: { ...find, args: { lineNumber: b.any, columnNumber: b.any } },
    /** The constructor caches its `options.lineLengths`. A map of `findSourceMap()` computes the array on the first read. */
    lineLengths: { getter: b.any.returning("Array", "undefined"), cache: true, capability: "js", throws: true },
    /** The constructor caches its `payload`. A map of `findSourceMap()` writes a v3 document on the first read. */
    payload: { getter: b.any.returning("object"), cache: true, capability: "js", throws: true },
  },
});

/** The map of a module that loaded while source maps were enabled (`--enable-source-maps`, `process.setSourceMapsEnabled(true)`). */
export const findSourceMap = b.fn({
  args: { path: b.any },
  returns: SourceMap.optional,
  capability: "js",
  throws: true,
});
