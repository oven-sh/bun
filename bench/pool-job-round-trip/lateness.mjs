// How late does the event loop run a timer while a chain of awaited CPU-bound pool jobs is in flight?
// A 2 ms interval timer records how late each tick is; a chain of awaited scrypt jobs (about 1.5 ms each) runs beside it.
//   bun lateness.mjs [seconds=3]
import { scrypt } from "node:crypto";
const seconds = +(process.argv[2] || 3);
const job = () => new Promise(r => scrypt("password", "salt", 32, { N: 1024 }, r));
const late = [];
let expected = performance.now() + 2;
const timer = setInterval(() => {
  const now = performance.now();
  late.push(now - expected);
  expected = now + 2;
}, 2);
const end = performance.now() + seconds * 1000;
let jobs = 0;
while (performance.now() < end) { await job(); jobs++; }
clearInterval(timer);
late.sort((a, b) => a - b);
const q = p => +(late[Math.min(late.length - 1, (late.length * p) | 0)] * 1000).toFixed(0);
console.log(JSON.stringify({ jobs, ticks: late.length, lateP50Us: q(0.5), lateP90Us: q(0.9), lateP99Us: q(0.99), lateMaxUs: q(1) }));
