import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::cli::upgrade_command::upgrade_js_bindings" });

export const upgradeTestHelpers = b.namespace({
  openTempDirWithoutSharingDelete: { length: 1 },
  closeTempDirHandle: { length: 1 },
});
