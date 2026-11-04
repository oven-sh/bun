// map values next field beside a plain object strict.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
const box = { k: Object.create(null) };
function run(n) {
  const k = new Map([[n, 2]]).values().next();
  box.k = k;
  const target = box.k;
  if (target) { target.value = 9; }
  const other = box.k;
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
