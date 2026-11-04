// either length of set step beside array field field.
function* numbers(n) { yield n; }
const meeting = { both: undefined };
const keeperOfObject = { objectKept: undefined };
const keeperOfRecord = { recordKept: undefined };
let recordInSight;
function fill(n) {
  const record = new Set([n, 2]).values().next();
  const object = [n, 2];
  meeting.both = record; if (n > 1) meeting.both = object;
  keeperOfObject.objectKept = object;
  keeperOfRecord.recordKept = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject.objectKept;
  const kept = keeperOfRecord.recordKept;
  const either = meeting.both;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
