// either length of map step beside array field variable.
function* numbers(n) { yield n; }
const meeting = { both: undefined };
let keeperOfObject;
let keeperOfRecord;
let recordInSight;
function fill(n) {
  const record = new Map([[n, 2]]).entries().next();
  const object = [n, 2];
  meeting.both = record; if (n > 1) meeting.both = object;
  keeperOfObject = object;
  keeperOfRecord = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject;
  const kept = keeperOfRecord;
  const either = meeting.both;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
