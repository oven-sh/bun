// Heap held after a synchronous burst of 200,000 process.stdout.write('x', cb) to /dev/null, before the first tick runs.
const { heapStats } = require("bun:jsc");
const kind = process.argv[2];
const N = 200000;
let ran = 0;
const shared = () => { ran++; };
Bun.gc(true);
const before = heapStats().heapSize;
for (let i = 0; i < N; i++) {
  if (kind === "shared") process.stdout.write("x", shared);
  else process.stdout.write("x", () => { ran++; });
}
Bun.gc(true);
const held = heapStats().heapSize - before;
process.stderr.write((held / 1048576).toFixed(2) + "\n");
