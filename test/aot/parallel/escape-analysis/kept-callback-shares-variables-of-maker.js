// A callback that writes a variable of the function that made it. Whether the callee borrows it or keeps it, maker and callback see one variable.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const callees = [f => f(1), f => { kept.push(f); return f(1); }];
function count(i) {
  let n = 0;
  const readers = [];
  pick(callees, i & 1)(d => { n += d; return n; });
  n += 10;
  pick(callees, i >> 1 & 1)(d => { n += d * 2; readers.push(() => n); return n; });
  return () => n + readers.length;
}
const results = [];
for (let i = 0; i < 400; i++) results.push(count(i));
for (const f of kept) f(100);
let sum = 0; for (const r of results) sum += r();
console.log(kept.length, sum);
// Nothing but the callback holds the variable. A callee that has kept the callback still has that variable when the maker has run again and again.
const held = [];
const takers = [f => f(1), f => { held.push(f); return f(1); }];
function tally(i) { let n = i * 10; pick(takers, i & 1)(d => { n += d; return n; }); return n; }
let tallied = 0;
for (let i = 0; i < 2000; i++) tallied += tally(i);
let later = 0;
for (const f of held) later += f(0);
console.log(tallied, held.length, later);
