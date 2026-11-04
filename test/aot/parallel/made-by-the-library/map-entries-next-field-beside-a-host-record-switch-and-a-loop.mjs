// map entries next field beside a host record switch and a loop.
function* numbers(n) { yield n; }
function stepOf(it) { return it.next(); }
const box = { k: Promise.withResolvers() };
function run(n) {
  const k = new Map([[n, 2]]).entries().next();
  box.k = k;
  const target = box.k;
  if (target) { target.value = 9; }
  const other = box.k;
  return (() => { switch (other) { case k: return "same"; default: return "another"; } })();
}
try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }
for (const x of [1]) console.log(x);
