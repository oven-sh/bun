import * as b from "../../codegen/bindgen-lib.ts";

const code = b.bytes({ from: ["string", "buffer"], held: "handle" });
const loader = b.string.utf8.nullable;
const expected = (method: string) => ({
  code: `Expected code to be a string or Uint8Array for '${method}'.`,
  loader: "loader must be a string",
});
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
    scan: { ...method, args: { code, loader }, expected: expected("scan") },
    scanImports: { ...method, args: { code, loader }, expected: expected("scanImports") },
    transform: {
      ...method,
      args: { code: b.bytes({ from: ["string", "buffer"], held: "handle", string: "asIs" }), loader: b.any },
      expected: { code: expected("transform").code },
      passThis: true,
    },
    transformSync: {
      ...method,
      args: { code, loaderOrContext: b.any, context: b.any },
      expected: { code: expected("transformSync").code },
      returns: b.string.local,
    },
  },
});
