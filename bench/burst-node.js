// node reference for burst.js: heap held after 200,000 process.stdout.write('x', cb) to /dev/null, before the first tick runs.
const kind = process.argv[2];
const N = 200000;
let ran = 0;
const shared = () => { ran++; };
global.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < N; i++) {
  if (kind === "shared") process.stdout.write("x", shared);
  else process.stdout.write("x", () => { ran++; });
}
global.gc();
process.stderr.write(((process.memoryUsage().heapUsed - before) / 1048576).toFixed(2) + "\n");
