// either length of string step beside array variable field.
function* numbers(n) { yield n; }
let shared;
const keeperOfObject = { objectKept: undefined };
const keeperOfRecord = { recordKept: undefined };
let recordInSight;
function fill(n) {
  const record = "ab"[Symbol.iterator]().next();
  const object = [n, 2];
  shared = record; if (n > 1) shared = object;
  keeperOfObject.objectKept = object;
  keeperOfRecord.recordKept = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.objectKept;
  const kept = keeperOfRecord.recordKept;
  const either = shared;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
