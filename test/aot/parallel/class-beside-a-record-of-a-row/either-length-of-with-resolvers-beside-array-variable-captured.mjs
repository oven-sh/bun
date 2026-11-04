// either length of with resolvers beside array variable captured.
function* numbers(n) { yield n; }
let shared;
function cellForobject() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfObject = cellForobject();
function cellForrecord() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfRecord = cellForrecord();
let recordInSight;
function fill(n) {
  const record = Promise.withResolvers();
  const object = [n, 2];
  shared = record; if (n > 1) shared = object;
  keeperOfObject.put(object);
  keeperOfRecord.put(record);
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.get();
  const kept = keeperOfRecord.get();
  const either = shared;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
