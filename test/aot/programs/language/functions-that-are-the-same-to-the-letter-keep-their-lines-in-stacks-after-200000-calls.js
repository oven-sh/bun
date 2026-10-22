// the same, after each has run 200,000 times
const frames = e => e.stack.split("\n").slice(1, 3).map(l => l.trim().replace(/\(?[^ (]*[\/\\]([^\/\\:]+:\d+:\d+)\)?$/, "$1")).join(" | ");
function alpha(x) { if (x < 0) throw new RangeError("below"); return x * 2 + 1; }
function beta(x) { if (x < 0) throw new RangeError("below"); return x * 2 + 1; }
let sum = 0; for (let i = 0; i < 200000; i++) sum += alpha(i) - beta(i);
for (const f of [alpha, beta]) { try { f(-1); } catch (e) { console.log(f.name, frames(e)); } }
console.log(sum);
