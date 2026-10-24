import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::install_binding" });

export const installTestHelpers = b.namespace({
  parseLockfile: {
    args: { cwd: b.string.loose.utf8 },
    returns: b.opaque,
    capability: "js",
    throws: true,
  },
});
