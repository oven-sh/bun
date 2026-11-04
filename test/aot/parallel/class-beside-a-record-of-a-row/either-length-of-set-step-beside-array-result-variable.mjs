// either length of set step beside array result variable.
function* numbers(n) { yield n; }
function pick(first, a, b) { return first ? a : b; }
let picked;
let keeperOfObject;
let keeperOfRecord;
let recordInSight;
function fill(n) {
  const record = new Set([n, 2]).values().next();
  const object = [n, 2];
  picked = pick(n > 1, record, object);
  keeperOfObject = object;
  keeperOfRecord = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject;
  const kept = keeperOfRecord;
  const either = picked;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
