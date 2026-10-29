// A 1 ms interval timer beside a chain of awaited fs.promises.stat calls: ticks per second and how late they are.
//   bun ticks.mjs [seconds=3]
import fs from "node:fs";
const seconds = +(process.argv[2] || 3);
const late = [];
let expected = performance.now() + 1;
const timer = setInterval(() => { const now = performance.now(); late.push(now - expected); expected = now + 1; }, 1);
const end = performance.now() + seconds * 1000;
let calls = 0;
while (performance.now() < end) { await fs.promises.stat("/tmp"); calls++; }
clearInterval(timer);
late.sort((a, b) => a - b);
const q = p => +(late[Math.min(late.length - 1, (late.length * p) | 0)] * 1000).toFixed(0);
console.log(JSON.stringify({ callsPerSec: Math.round(calls / seconds), ticksPerSec: Math.round(late.length / seconds), lateP50Us: q(0.5), lateP99Us: q(0.99) }));
