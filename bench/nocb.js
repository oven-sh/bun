// callback-less process.stdout.write: ns per write, after a warm-up. usage: nocb.js <class> <iters>
const cls = process.argv[2];
const N = +process.argv[3];
const chunk = {
  latin1: "hello world\n",
  utf16: "h\u00e9llo w\u00f6rld \u2713\n",
  buffer: Buffer.alloc(64, 0x61),
  big: Buffer.alloc(30000, "a").toString(),
}[cls];
for (let i = 0; i < 50000; i++) process.stdout.write(chunk);
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) process.stdout.write(chunk);
const t1 = process.hrtime.bigint();
process.stderr.write((Number(t1 - t0) / N).toFixed(2) + "\n");
