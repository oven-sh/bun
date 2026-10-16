// The cost of one write(chunk, cb) through a plain Writable whose _write completes at once: the floor for any design that reports through Writable.
const { Writable } = require("node:stream");
const kind = process.argv[2];
const N = +process.argv[3];
const w = new Writable({ write(chunk, encoding, cb) { cb(null); } });
const chunk = Buffer.alloc(0);
let done = 0, t0;
const finish = () => process.stderr.write((Number(process.hrtime.bigint() - t0) / N).toFixed(2) + "\n");
function warm(then) { let n = 0; const step = () => { if (++n < 2000) w.write(chunk, step); else then(); }; step(); }
warm(() => {
  t0 = process.hrtime.bigint();
  if (kind === "shared") { const cb = () => { if (++done === N) finish(); }; for (let i = 0; i < N; i++) w.write(chunk, cb); }
  else if (kind === "fresh") { for (let i = 0; i < N; i++) w.write(chunk, () => { if (++done === N) finish(); }); }
  else { const next = () => { if (++done === N) finish(); else w.write(chunk, next); }; w.write(chunk, next); }
});
