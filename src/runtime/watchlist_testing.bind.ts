// A function that exists to test a watchlist of more than 65,535 entries: test/cli/hot/watch-many-dirs.test.ts
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::watchlist_testing" });

export const padWatchlistForTesting = b.fn({
  args: { length: b.u32 },
  returns: b.usize,
  capability: "heap",
  throws: true,
});
