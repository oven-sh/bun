// Each turn of a loop makes a callback of its own. A callee that keeps them has as many different functions as there were turns, each with what it captured in its turn.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const seen = new Set();
const callees = [f => f(), f => { kept.push(f); seen.add(f); return f(); }, f => { seen.add(f); return 0; }];
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const callee = pick(callees, i % 3);
  sum += callee(() => i * 2);
  for (let j = 0; j < 2; j++) sum += pick(callees, (i + j) % 3)(() => i + j);
}
let again = 0;
for (const f of kept) again += f();
console.log(sum, kept.length, seen.size, again);
// One callback, made outside the loop, handed over in every turn, is one function.
const once = () => 1;
const set = new Set();
for (let i = 0; i < 10; i++) pick([f => set.add(f), f => f()], i & 1)(once);
console.log(set.size);
