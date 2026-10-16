// Heap objects retained per write before its completion is delivered.
// usage: objects.js <nocb|shared|fresh> <idle|parked>   (20,000 writes; full GC before each reading)
const { heapStats } = require("bun:jsc");
const [kind, state] = process.argv.slice(2);
const chunk = "x";
if (state === "parked") {
  const big = Buffer.alloc(4096, 0x61);
  while (process.stdout.write(big)) {}
}
const N = 20000;
let ran = 0;
const shared = () => { ran++; };
Bun.gc(true);
const before = heapStats();
for (let i = 0; i < N; i++) {
  if (kind === "nocb") process.stdout.write(chunk);
  else if (kind === "shared") process.stdout.write(chunk, shared);
  else process.stdout.write(chunk, () => { ran++; });
}
Bun.gc(true);
const after = heapStats();
process.stderr.write(JSON.stringify({
  kind, state,
  objectsPerWrite: +((after.objectCount - before.objectCount) / N).toFixed(2),
  heapBytesPerWrite: +((after.heapSize - before.heapSize) / N).toFixed(1),
}) + "\n");
process.exit(0);
