import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::npm_jsc" });

export const operatingSystemIsMatch = b.fn({
  args: { names: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});

export const architectureIsMatch = b.fn({
  args: { names: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});

export const npmManifestTestHelpers = b.namespace({
  parseManifest: {
    args: { manifestFilename: b.string, registry: b.string },
    returns: b.any,
    capability: "heap",
    throws: true,
  },
});
