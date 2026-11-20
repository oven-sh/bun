import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::SemverObject" });

/** node-semver's options: `loose` and `rtl` are accepted and ignored, like any unknown key. */
export const SatisfiesOptions = b.dictionary(
  { includePrerelease: b.bool.loose.default(false) },
  { allowArray: true, nonObjectAsEmpty: "typeof" },
);

export const semver = b.namespace({
  satisfies: {
    args: {
      version: b.string.loose.utf8,
      range: b.string.loose.utf8,
      options: SatisfiesOptions.nullable.default({}),
    },
    returns: b.bool,
    throws: true,
  },
  order: {
    args: { left: b.string.loose.utf8, right: b.string.loose.utf8 },
    returns: b.i32,
    capability: "heap",
    throws: true,
  },
});
