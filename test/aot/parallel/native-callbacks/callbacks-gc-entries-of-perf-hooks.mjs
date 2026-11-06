// Callbacks handed over: the function of node:perf_hooks that native code calls for each collection. What an observer of 'gc' gets for a forced collection; an observer that named another type first; nothing while nobody observes; one entry for each of a hundred collections.
import { PerformanceObserver, constants, performance } from "node:perf_hooks";
const keep = setInterval(() => {}, 1000);
const isForced = entry => entry.entryType === "gc" && entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
const describe = entry =>
  [
    entry.name,
    entry.entryType,
    typeof entry.startTime,
    typeof entry.duration,
    entry.duration > 0,
    entry.startTime <= performance.now(),
    entry.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR,
    Object.keys(entry.toJSON()).join(),
  ].join(" ");
function forcedOnce(label, prepare) {
  return new Promise(resolve => {
    const observer = new PerformanceObserver(list => {
      const forced = list.getEntries().filter(isForced);
      if (!forced.length) return;
      observer.disconnect();
      resolve(label + ": " + forced.length + " | " + describe(forced[0]));
    });
    prepare(observer);
    Bun.gc(true);
  });
}
console.log(await forcedOnce("type", observer => observer.observe({ type: "gc" })));
// Nothing observes now: this one is nobody's.
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(await forcedOnce("entryTypes", observer => observer.observe({ entryTypes: ["function", "gc"] })));
console.log(
  await forcedOnce("another type first", observer => {
    observer.observe({ entryTypes: ["function"] });
    observer.observe({ entryTypes: ["gc", "function"] });
  }),
);

let forced = 0;
const counting = new PerformanceObserver(list => {
  forced += list.getEntries().filter(isForced).length;
});
counting.observe({ type: "gc" });
let garbage = [];
for (let round = 0; round < 100; round++) {
  for (let i = 0; i < 2000; i++) garbage.push({ round, i, text: "t" + i });
  garbage = [];
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
for (let wait = 0; wait < 200 && forced < 100; wait++) await new Promise(resolve => setTimeout(resolve, 5));
counting.disconnect();
console.log(forced, "forced collections have an entry");
console.log(PerformanceObserver.supportedEntryTypes.includes("gc"));
clearInterval(keep);
