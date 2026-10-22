import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::cli::pack_command::bindings" });

export const readTarball = b.fn({
  args: { tarballPath: b.string },
  returns: b.any,
  capability: "js",
  throws: true,
});
