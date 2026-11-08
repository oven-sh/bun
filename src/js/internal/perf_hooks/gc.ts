// The 'gc' entries of node:perf_hooks, loaded by their first observer. GCPerformanceEntries.cpp calls emitGCEntry() for each collection, on a later tick.
const { NodeEntryObserver, enqueueNodeEntry, hasObserver, PerformanceNodeEntry } = require("internal/shared");

const setGCEntryListener: (listener: typeof emitGCEntry | undefined) => void = $newCppFunction(
  "GCPerformanceEntries.cpp",
  "jsFunctionSetGCPerformanceEntryListener",
  1,
);
const ObjectSetPrototypeOf = Object.setPrototypeOf;

let constants: Record<string, number>;
let isGCEntryListenerSet = false;

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.h#L112-L140
function emitGCEntry(startTime: number, duration: number, isFullCollection: boolean, forced: boolean) {
  const detail = {
    kind: isFullCollection ? constants.NODE_PERFORMANCE_GC_MAJOR : constants.NODE_PERFORMANCE_GC_MINOR,
    flags: forced ? constants.NODE_PERFORMANCE_GC_FLAGS_FORCED : constants.NODE_PERFORMANCE_GC_FLAGS_NO,
  };
  enqueueNodeEntry(new PerformanceNodeEntry("gc", "gc", startTime, duration, detail));
}

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.cc#L254-L275
function updateGCTracking() {
  const wanted = hasObserver("gc");
  if (wanted === isGCEntryListenerSet) return;
  isGCEntryListenerSet = wanted;
  setGCEntryListener(wanted ? emitGCEntry : undefined);
}

// The registry itself calls disconnect() for the observer of a disposed Bun.ModuleGraph, so the count of 'gc' observers is followed here.
class GCEntryObserver extends NodeEntryObserver {
  observe(types: Iterable<string>) {
    super.observe(types);
    updateGCTracking();
  }

  disconnect() {
    super.disconnect();
    updateGCTracking();
  }
}

export default {
  /** For a registration that starts to observe 'gc'. GCEntryObserver adds no state, so it only changes class. The kinds and flags of an entry are read from `nodeConstants`, the `constants` of node:perf_hooks. */
  observeGC(registration: InstanceType<typeof NodeEntryObserver>, nodeConstants: Record<string, number>) {
    constants = nodeConstants;
    if (!(registration instanceof GCEntryObserver)) ObjectSetPrototypeOf(registration, GCEntryObserver.prototype);
  },
};
