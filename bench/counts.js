// Ticks and heap objects per write. usage: counts.js <nocb|shared|fresh> <idle|parked>
// idle: stdout takes every chunk.  parked: stdout is a FIFO nobody reads, filled first, so every write parks.
const { heapStats } = require("bun:jsc");
const [kind, state] = process.argv.slice(2);
let ticks = 0;
const nextTick = process.nextTick;
process.nextTick = function (...args) {
  ticks++;
  return nextTick.apply(this, args);
};
const chunk = "x";
let filled = 0;
if (state === "parked") {
  const big = Buffer.alloc(4096, 0x61);
  while (process.stdout.write(big)) filled++;
}
const N = 1000;
let ran = 0;
const shared = () => { ran++; };
const ticksBefore = ticks;
const objectsBefore = heapStats().objectCount;
let accepted = 0;
for (let i = 0; i < N; i++) {
  const ok = kind === "nocb" ? process.stdout.write(chunk)
    : kind === "shared" ? process.stdout.write(chunk, shared)
    : process.stdout.write(chunk, () => { ran++; });
  if (ok) accepted++;
}
const result = {
  kind, state, accepted, parked: N - accepted,
  callbacksInsideWrite: ran,
  ticksQueuedDuringWrites: ticks - ticksBefore,
  objectsPerWrite: +((heapStats().objectCount - objectsBefore) / N).toFixed(2),
};
if (state === "idle") {
  setImmediate(() => {
    result.ticksTotal = ticks - ticksBefore;
    result.callbacksTotal = ran;
    process.stderr.write(JSON.stringify(result) + "\n");
  });
} else {
  // Let the writes complete: read the FIFO from this process.
  const fs = require("node:fs");
  const readFd = fs.openSync(process.env.FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const scratch = Buffer.alloc(65536);
  const pump = () => {
    for (;;) { try { if (fs.readSync(readFd, scratch, 0, scratch.length, null) === 0) break; } catch (e) { if (e.code === "EAGAIN") break; throw e; } }
    if ((kind === "nocb" ? pumped++ > 50 : ran >= N)) {
      result.ticksTotal = ticks - ticksBefore;
      result.callbacksTotal = ran;
      process.stderr.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }
    setImmediate(pump);
  };
  let pumped = 0;
  pump();
}
