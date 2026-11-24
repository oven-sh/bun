// A process that works, goes quiet, and then works once more: it allocates a burst, uses it for a short time and drops
// it. The arguments are the run time in milliseconds, when the burst starts, the megabytes that stay alive, the
// megabytes of the burst, and how long the burst is used. All times count from the start of the process.
const [ms = 18000, startMs = 5100, liveMb = 150, burstMb = 36, holdMs = 400] = process.argv.slice(2).map(Number);
const row = i => ({ id: i, name: "row-" + i, tags: ["a" + i, "b" + i], extra: { a: i, c: [i, i + 1] } });
const rows = megabytes => {
  const list = [];
  for (let i = 0, count = Math.round((megabytes * 1048576) / 330); i < count; i++) list.push(row(i));
  return list;
};
globalThis.live = rows(liveMb);
// Garbage for the first collection after startup, so that the runtime has seen a collection that frees something.
setTimeout(() => void rows(40), 1100 - performance.now());
setTimeout(() => {
  let burst = rows(burstMb);
  setTimeout(() => {
    burst = null;
  }, holdMs);
}, startMs - performance.now());
setTimeout(() => process.exit(0), ms - performance.now());
