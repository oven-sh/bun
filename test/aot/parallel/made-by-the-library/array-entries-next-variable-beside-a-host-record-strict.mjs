// array entries next variable beside a host record strict.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
let kept = Promise.withResolvers();
function run(n) {
  const k = [n, 2].entries().next();
  kept = k;
  const target = kept;
  if (target) { target.value = 9; }
  const other = kept;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
