// The 'gc' entries of node:perf_hooks, loaded by their first observer. GCPerformanceEntries.cpp calls emitGCEntry() for each collection, on a later tick.
const { NodeEntryObserver, enqueueNodeEntry, hasObserver, PerformanceNodeEntry } = require("internal/shared");

const setGCEntryListener: (listener: typeof emitGCEntry | undefined) => void = $newCppFunction(
  "GCPerformanceEntries.cpp",
  "jsFunctionSetGCPerformanceEntryListener",
  1,
);
const { observe, disconnect } = NodeEntryObserver.prototype;

// Node's numbers, from v8::GCType and v8::GCCallbackFlags. The `constants` of node:perf_hooks name them too, and a program can change that object.
const kGCMinor = 1;
const kGCMajor = 4;
const kGCFlagsNo = 0;
const kGCFlagsForced = 4;

let isGCEntryListenerSet = false;

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.h#L112-L140
function emitGCEntry(startTime: number, duration: number, isFullCollection: boolean, forced: boolean) {
  const detail = { kind: isFullCollection ? kGCMajor : kGCMinor, flags: forced ? kGCFlagsForced : kGCFlagsNo };
  enqueueNodeEntry(new PerformanceNodeEntry("gc", "gc", startTime, duration, detail));
}

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.cc#L254-L275
function updateGCTracking() {
  const wanted = hasObserver("gc");
  if (wanted === isGCEntryListenerSet) return;
  isGCEntryListenerSet = wanted;
  setGCEntryListener(wanted ? emitGCEntry : undefined);
}

function observeAndTrackGC(this: InstanceType<typeof NodeEntryObserver>, types: Iterable<string>) {
  observe.$call(this, types);
  updateGCTracking();
}

function disconnectAndTrackGC(this: InstanceType<typeof NodeEntryObserver>) {
  disconnect.$call(this);
  updateGCTracking();
}

export default {
  /** For a registration that starts to observe 'gc'. The registry itself calls disconnect() for the observer of a disposed Bun.ModuleGraph, so the registration gets methods of its own that follow the count of 'gc' observers. */
  observeGC(registration: InstanceType<typeof NodeEntryObserver>) {
    registration.observe = observeAndTrackGC;
    registration.disconnect = disconnectAndTrackGC;
  },
};
