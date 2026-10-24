import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ini_jsc" });

export const parse = b.fn({
  args: { source: b.string.loose.utf8 },
  returns: b.object,
  capability: "heap",
  throws: true,
});

/** Without one, the variables of the process. */
export const NpmrcEnv = b.union({ inherited: b.null, variables: b.object, other: b.ignored });

export const loadNpmrc = b.fn({
  args: { contents: b.string.loose.utf8, env: NpmrcEnv },
  returns: b.opaque,
  capability: "js",
  throws: true,
});
