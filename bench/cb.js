// process.stdout.write(chunk, cb): ns per write from the first write to the last callback.
// usage: cb.js <shared|fresh|chain> <iters>
const kind = process.argv[2];
const N = +process.argv[3];
const chunk = "hello world\n";
let done = 0;
let t0;
const finish = () => {
  const t1 = process.hrtime.bigint();
  process.stderr.write((Number(t1 - t0) / N).toFixed(2) + "\n");
};
function warm(then) {
  let w = 0;
  const step = () => { if (++w < 2000) process.stdout.write(chunk, step); else then(); };
  step();
}
warm(() => {
  t0 = process.hrtime.bigint();
  if (kind === "shared") {
    const cb = () => { if (++done === N) finish(); };
    for (let i = 0; i < N; i++) process.stdout.write(chunk, cb);
  } else if (kind === "fresh") {
    for (let i = 0; i < N; i++) process.stdout.write(chunk, () => { if (++done === N) finish(); });
  } else {
    const next = () => { if (++done === N) finish(); else process.stdout.write(chunk, next); };
    process.stdout.write(chunk, next);
  }
});
