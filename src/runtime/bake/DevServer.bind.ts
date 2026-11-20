import * as b from "../../codegen/bindgen-lib.ts";

export const getDeinitCountForTesting = b.fn({
  returns: b.usize,
  rustPath: "crate::bake::get_deinit_count_for_testing",
});
