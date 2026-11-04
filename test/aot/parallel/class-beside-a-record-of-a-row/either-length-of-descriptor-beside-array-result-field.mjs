// either length of descriptor beside array result field.
function* numbers(n) { yield n; }
function pick(first, a, b) { return first ? a : b; }
let picked;
const keeperOfObject = { objectKept: undefined };
const keeperOfRecord = { recordKept: undefined };
let recordInSight;
function fill(n) {
  const record = Object.getOwnPropertyDescriptor({ x: n }, "x");
  const object = [n, 2];
  picked = pick(n > 1, record, object);
  keeperOfObject.objectKept = object;
  keeperOfRecord.recordKept = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.objectKept;
  const kept = keeperOfRecord.recordKept;
  const either = picked;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
