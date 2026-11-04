// array values next variable beside a plain object strict.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
let kept = Object.create(null);
function run(n) {
  const k = [n, 2].values().next();
  kept = k;
  const target = kept;
  if (target) { target.value = 9; }
  const other = kept;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
