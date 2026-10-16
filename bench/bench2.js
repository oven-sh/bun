// process.stdout.write(chunk[, cb]) to /dev/null. usage: bench2.js <nocb|shared|fresh|chain> <N> <reps>
// Each rep: N writes, then waits for the N callbacks. Prints min wall ns/write and min cpu ns/write over the reps (first 3 reps dropped).
const kind = process.argv[2], N = +process.argv[3], reps = +process.argv[4] || 20;
const chunk = "hello world\n";
const wall = [], cpu = [];
function once(done) {
  let n = 0;
  const c0 = process.cpuUsage(); const t0 = process.hrtime.bigint();
  const fin = () => { const c = process.cpuUsage(c0); done(Number(process.hrtime.bigint() - t0) / N, (c.user + c.system) * 1000 / N); };
  if (kind === "nocb") { for (let i = 0; i < N; i++) process.stdout.write(chunk); fin(); }
  else if (kind === "shared") { const cb = () => { if (++n === N) fin(); }; for (let i = 0; i < N; i++) process.stdout.write(chunk, cb); }
  else if (kind === "fresh") { for (let i = 0; i < N; i++) process.stdout.write(chunk, () => { if (++n === N) fin(); }); }
  else if (kind === "chain") { const next = () => { if (++n === N) fin(); else process.stdout.write(chunk, next); }; process.stdout.write(chunk, next); }
  else throw new Error("kind");
}
let r = 0;
(function rep() {
  once((w, c) => {
    if (r >= 3) { wall.push(w); cpu.push(c); }
    if (++r < reps) setImmediate(rep);
    else process.stderr.write(Math.min(...wall).toFixed(1) + " " + Math.min(...cpu).toFixed(1) + "\n");
  });
})();
