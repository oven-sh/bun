// array values next captured variable beside a plain object strict.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
function cellOf(first) { let held = first; return { put(v) { held = v; }, get() { return held; } }; }
const cell = cellOf(Object.create(null));
function run(n) {
  const k = [n, 2].values().next();
  cell.put(k);
  const target = cell.get();
  if (target) { target.value = 9; }
  const other = cell.get();
  return other === k;
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
