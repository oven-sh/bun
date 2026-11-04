// from entries field alone strict and a loop.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
const box = { k: undefined };
function run(n) {
  const k = Object.fromEntries([["x", n]]);
  box.k = k;
  const target = box.k;
  if (target) { target.value = 9; }
  const other = box.k;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
for (const x of [1]) console.log(x);
