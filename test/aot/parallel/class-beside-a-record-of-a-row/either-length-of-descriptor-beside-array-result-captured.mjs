// either length of descriptor beside array result captured.
function* numbers(n) { yield n; }
function pick(first, a, b) { return first ? a : b; }
let picked;
function cellForobject() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfObject = cellForobject();
function cellForrecord() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfRecord = cellForrecord();
let recordInSight;
function fill(n) {
  const record = Object.getOwnPropertyDescriptor({ x: n }, "x");
  const object = [n, 2];
  picked = pick(n > 1, record, object);
  keeperOfObject.put(object);
  keeperOfRecord.put(record);
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.get();
  const kept = keeperOfRecord.get();
  const either = picked;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
