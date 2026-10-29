// One awaited job, then the process stays idle behind a timer. Prints what the threads did while idle.
//   bun idle.mjs [seconds=5]
import { hkdf } from "node:crypto";
import fs from "node:fs";
const seconds = +(process.argv[2] || 5);
function threads() {
  let vol = 0, invol = 0, pool = 0;
  for (const tid of fs.readdirSync("/proc/self/task")) {
    let st; try { st = fs.readFileSync(`/proc/self/task/${tid}/status`, "utf8"); } catch { continue; }
    if (/^Name:\s+Bun Pool /m.test(st)) pool++;
    vol += +/^voluntary_ctxt_switches:\s+(\d+)/m.exec(st)[1];
    invol += +/^nonvoluntary_ctxt_switches:\s+(\d+)/m.exec(st)[1];
  }
  return { vol, invol, pool };
}
await new Promise(done => hkdf("sha256", "key", "salt", "info", 32, done));
await new Promise(done => setTimeout(done, 100));
const before = threads(), cpu0 = process.cpuUsage();
await new Promise(done => setTimeout(done, seconds * 1000));
const after = threads(), cpu = process.cpuUsage(cpu0);
console.log(JSON.stringify({ poolThreads: after.pool, idleCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2), voluntarySwitches: after.vol - before.vol, involuntarySwitches: after.invol - before.invol }));
