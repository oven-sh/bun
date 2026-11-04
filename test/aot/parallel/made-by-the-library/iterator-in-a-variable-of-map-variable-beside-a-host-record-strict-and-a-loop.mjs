// iterator in a variable of map variable beside a host record strict and a loop.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
let kept = Promise.withResolvers();
function run(n) {
  const k = ((it) => it.next())(new Map([[n, 2]]).values());
  kept = k;
  const target = kept;
  if (target) { target.value = 9; }
  const other = kept;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
for (const x of [1]) console.log(x);
