// An object that others inherit from is given a name and keeps its names in a table of its own from then on. Above it stands an array or an instance of a class.
// Names that are made when the program runs are asked of the lowest object and read from it.
// Env: BUN_JSC_forceDidDeferGCWork=1
function has(object, key) {
  return key in object;
}
function read(object, key) {
  return object[key];
}
class Top {
  get probe() {
    return 1;
  }
}
const few = process.argv.length > 9 ? 1 : 3;
const keys = [
  "add" + "ed!".slice(0, few - 1),
  "abs" + "ent".slice(0, few),
  "len" + "gth".slice(0, few),
  "pro" + "be!".slice(0, few - 1),
];
let found = 0;
let sum = 0;
for (let round = 0; round < 50; round++) {
  const kept = { round, list: [round + 0.5] };
  const between = Object.create(round % 2 ? [] : new Top());
  const below = Object.create(between);
  between.added = round;
  for (const key of keys) {
    if (has(below, key)) found++;
    sum += (read(below, key) ?? 0) + kept.round + kept.list[0];
  }
}
console.log(found, sum);
