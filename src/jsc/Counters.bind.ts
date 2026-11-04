import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::counters" });

/** Totals of the process, over every thread: lookups that missed and ran again, `DirInfo` records filled (none is freed), listings made, and listings read again in place. */
export const ResolverCounters = b.dictionary({
  lookupsRunAgain: b.usize,
  dirInfoSlots: b.usize,
  newListings: b.usize,
  refills: b.usize,
});

export const CountersObject = b.dictionary({
  spawnSync_blocking: b.i32,
  spawn_memfd: b.i32,
  resolver: ResolverCounters,
});

export const createCountersObject = b.fn({ returns: CountersObject, capability: "heap" });
