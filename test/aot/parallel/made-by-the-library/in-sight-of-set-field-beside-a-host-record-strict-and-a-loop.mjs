// in sight of set field beside a host record strict and a loop.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
const box = { k: Promise.withResolvers() };
function run(n) {
  const k = new Set([n, 2]).values().next();
  box.k = k;
  const target = box.k;
  if (target) { target.value = 9; }
  const other = box.k;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
for (const x of [1]) console.log(x);
