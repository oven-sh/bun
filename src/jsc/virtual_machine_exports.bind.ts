import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::virtual_machine_exports" });

export const setSyntheticAllocationLimitForTesting = b.fn({
  args: { limit: b.any },
  returns: b.usize,
  capability: "js",
  throws: true,
});
