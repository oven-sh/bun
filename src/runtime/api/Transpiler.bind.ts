import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any, capability: "js", throws: true, length: 2 } as const;

export const Transpiler = b.class({
  rustPath: "crate::api::js_transpiler::JSTranspiler",
  refCounted: true,
  configurable: false,
  construct: {
    args: { options: b.any },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    scan: { ...method, args: { code: b.any, loader: b.any } },
    scanImports: { ...method, args: { code: b.any, loader: b.any } },
    transform: { ...method, args: { code: b.any, loader: b.any }, passThis: true },
    transformSync: { ...method, args: { code: b.any, loaderOrContext: b.any, context: b.any } },
  },
});
