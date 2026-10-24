// An object literal that gets 5,000 computed keys works as a map (read, replace, delete, list, inherit), and objects filled with the same few keys in the same order share structures.
const counts = typeof aotOperationCount === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function calls(name) { return counts ? Number(aotOperationCount("operationAOT" + name)) : 0; }
function expectBetween(what, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
const size = JSON.parse("5000");
const names = JSON.parse('["alpha","beta","gamma","delta","epsilon"]');

function createRecord(seed) {
  const record = {};
  for (let i = 0; i < names.length; i++) record[names[i]] = seed + i;
  return record;
}
function createMap(count) {
  const map = {};
  for (let i = 0; i < count; i++) map["key" + i] = i * 3;
  return map;
}
function sumOf(map, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const value = map["key" + i];
    sum += value === undefined ? -1 : value;
  }
  return sum;
}
function countIn(map, count) {
  let present = 0;
  for (let i = 0; i < count; i++) if (("key" + i) in map) present++;
  return present;
}
function replaceEach(map, step, count) {
  for (let i = 0; i < count; i += step) map["key" + i] = -i;
}
function removeEach(map, step, count) {
  let removed = 0;
  for (let i = 0; i < count; i += step) if (delete map["key" + i]) removed++;
  return removed;
}
function describeKeys(map) {
  const keys = Object.keys(map);
  let listed = 0, descents = 0;
  for (const key in map) listed++;
  for (let i = 1; i < keys.length; i++) if (Number(keys[i].slice(3)) < Number(keys[i - 1].slice(3))) descents++;
  return keys.length + " keys, " + listed + " in for-in, " + descents + " out of numeric order, first " + keys[0] + ", last " + keys[keys.length - 1];
}
function describe(what, map) {
  console.log(what + ": sum " + sumOf(map, size + 10) + ", present " + countIn(map, size + 10) + ", " + describeKeys(map));
}
function repeated(access) {
  const answer = access();
  for (let i = 1; i < 100; i++) {
    const next = access();
    if (next !== answer) return answer + " then " + next + " at " + i;
  }
  return answer;
}

const missesBefore = calls("PutByValGeneric");
const records = [];
for (let n = 0; n < 10; n++) records.push(createRecord(n * 10));
expectBetween("keyed stores that missed the table while ten records were filled", calls("PutByValGeneric") - missesBefore, 0, 35);
for (const record of records) console.log(JSON.stringify(record));

const map = createMap(size);
describe("filled", map);
replaceEach(map, 2, size);
describe("every second value replaced", map);
console.log("removed " + removeEach(map, 3, size));
describe("every third key removed", map);
for (let i = 0; i < 30; i += 3) map["key" + i] = i;
describe("ten keys added again", map);

const probe = "key" + hidden(size - 1);
console.log("one key cell: " + repeated(() => map[probe]) + " " + repeated(() => probe in map));
delete map[probe];
console.log("removed: " + repeated(() => map[probe]) + " " + repeated(() => probe in map));
for (let i = 0; i < 100; i++) map[probe] = i;
console.log("stored again: " + repeated(() => map[probe]) + " " + repeated(() => probe in map));

const parent = {};
const grandparent = {};
Object.setPrototypeOf(map, parent);
const small = Object.create(parent);
small.own = 1;
const underFrozen = Object.create(Object.freeze(Object.create(grandparent)));
const absent = "key" + hidden(size + 3);
function look(what) {
  const seen = [map, small, underFrozen].map(object => repeated(() => object[absent]) + " " + repeated(() => object["key" + (size + 3)]) + " " + repeated(() => absent in object) + " " + repeated(() => ("key" + (size + 3)) in object));
  console.log(what + ": " + seen.join(" | "));
}
look("absent");
parent[absent] = 1000000;
grandparent[absent] = 2000000;
look("prototypes gained the name");
describe("with an inherited name", map);
delete parent[absent];
delete grandparent[absent];
look("prototypes lost the name");

expectBetween("keyed stores that entered the caching operation", calls("PutByValAndCache"), 0, 10);
