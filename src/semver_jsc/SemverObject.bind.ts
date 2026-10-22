import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::SemverObject" });

export const semver = b.namespace({
  satisfies: {
    args: { version: b.string.loose.utf8, range: b.string.loose.utf8 },
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

export const intersects = b.fn({
  args: { left: b.string.loose.utf8, right: b.string.loose.utf8 },
  returns: b.bool,
  throws: true,
});
