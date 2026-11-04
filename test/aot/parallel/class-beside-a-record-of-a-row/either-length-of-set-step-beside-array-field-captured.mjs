// either length of set step beside array field captured.
function* numbers(n) { yield n; }
const meeting = { both: undefined };
function cellForobject() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfObject = cellForobject();
function cellForrecord() { let held; return { put(v) { held = v; }, get() { return held; } }; }
const keeperOfRecord = cellForrecord();
let recordInSight;
function fill(n) {
  const record = new Set([n, 2]).values().next();
  const object = [n, 2];
  meeting.both = record; if (n > 1) meeting.both = object;
  keeperOfObject.put(object);
  keeperOfRecord.put(record);
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.get();
  const kept = keeperOfRecord.get();
  const either = meeting.both;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
