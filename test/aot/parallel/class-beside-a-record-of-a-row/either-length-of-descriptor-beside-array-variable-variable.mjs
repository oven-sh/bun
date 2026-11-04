// either length of descriptor beside array variable variable.
function* numbers(n) { yield n; }
let shared;
let keeperOfObject;
let keeperOfRecord;
let recordInSight;
function fill(n) {
  const record = Object.getOwnPropertyDescriptor({ x: n }, "x");
  const object = [n, 2];
  shared = record; if (n > 1) shared = object;
  keeperOfObject = object;
  keeperOfRecord = record;
  recordInSight = record;
}
function observe(n) {
  const alone = keeperOfObject;
  const kept = keeperOfRecord;
  const either = shared;
  const record = recordInSight;
  return String(either.length);
}
const printed = [];
for (let n = 1; n <= 3; n++) {
  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }
}
console.log(printed.join(" "));
