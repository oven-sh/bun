import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::console_object" });

export const ConsoleTableSizes = b.dictionary({
  timerEntries: b.usize,
  timerCapacity: b.usize,
  countEntries: b.usize,
  countCapacity: b.usize,
});

export const tableSizesForTesting = b.fn({ returns: ConsoleTableSizes, capability: "heap" });
