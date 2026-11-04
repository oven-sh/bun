// Timers that are cleared and armed again while many others are pending.
//
//   bun set-timeout-churn.mjs [pending=1000000]
//
// "interleaved" clears one pending timer at random and arms its replacement, 50 times a tick.
// "batch" clears 50 and then arms 50.
const pending = Number(process.argv[2] ?? 1_000_000);
const perTick = 50;
const ticks = 2_000;
const warmup = 200;
const noop = () => {};

// The same indexes in each run and in each runtime.
let seed = 0x2545f491;
function random() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
}

const timers = [];
for (let i = 0; i < pending; i++) timers.push(setTimeout(noop, 3_600_000));

function interleaved() {
  if (!pending) {
    for (let k = 0; k < perTick; k++) clearTimeout(setTimeout(noop, 3_600_000));
    return;
  }
  for (let k = 0; k < perTick; k++) {
    const i = (random() * pending) | 0;
    clearTimeout(timers[i]);
    timers[i] = setTimeout(noop, 3_600_000);
  }
}

const indexes = new Array(perTick);
function batch() {
  if (!pending) {
    for (let k = 0; k < perTick; k++) indexes[k] = setTimeout(noop, 3_600_000);
    for (let k = 0; k < perTick; k++) clearTimeout(indexes[k]);
    return;
  }
  for (let k = 0; k < perTick; k++) {
    const i = (random() * pending) | 0;
    indexes[k] = i;
    clearTimeout(timers[i]);
  }
  for (let k = 0; k < perTick; k++) timers[indexes[k]] = setTimeout(noop, 3_600_000);
}

const fmt = new Intl.NumberFormat();
for (const [name, tick] of [
  ["interleaved", interleaved],
  ["batch", batch],
]) {
  for (let i = 0; i < warmup; i++) tick();
  const start = performance.now();
  for (let i = 0; i < ticks; i++) tick();
  const microseconds = ((performance.now() - start) * 1000) / ticks;
  console.log(
    `${fmt.format(pending)} pending, ${name}: ${microseconds.toFixed(1)} us for ${perTick} clearTimeout and ${perTick} setTimeout`,
  );
}
process.exit(0);
