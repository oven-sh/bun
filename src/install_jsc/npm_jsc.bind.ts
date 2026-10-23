import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::npm_jsc" });

export const operatingSystemIsMatch = b.fn({
  args: { names: b.array(b.string.loose.utf8.owned) },
  returns: b.bool,
});

export const architectureIsMatch = b.fn({
  args: { names: b.array(b.string.loose.utf8.owned) },
  returns: b.bool,
});

export const PackageManifest = b.dictionary({ name: b.string.utf8, versions: b.array(b.string.utf8) });

export const npmManifestTestHelpers = b.namespace({
  parseManifest: {
    args: { manifestFilename: b.string.utf8, registry: b.string.utf8 },
    returns: PackageManifest,
    capability: "heap",
    throws: true,
  },
});
