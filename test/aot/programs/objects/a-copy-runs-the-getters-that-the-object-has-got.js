// An object gets properties under keys that nobody knows and, in some of the rows, an accessor in a way of its own. Whoever copies it, lists its values or serializes it runs that accessor.
// A variable is read in front of the copy and behind it.
let runs = 0;
function count() {
  runs++;
  return 7;
}
const keys = ["p", "q", process.argv.length > 99 ? "r" : "s"];
function fill(o) {
  for (let i = 0; i < keys.length; i++) o[keys[i]] = i;
  return o;
}
const ways = {
  none(o) {},
  defineProperty(o) { Object.defineProperty(o, "g", { get: count, enumerable: true }); },
  defineProperties(o) { Object.defineProperties(o, { g: { get: count, enumerable: true } }); },
  reflect(o) { Reflect.defineProperty(o, "g", { get: count, enumerable: true }); },
  legacy(o) { o.__defineGetter__("g", count); },
  underKey(o) { Object.defineProperty(o, keys[2], { get: count, enumerable: true }); },
  descriptors(o) { Object.defineProperties(o, Object.getOwnPropertyDescriptors({ get g() { return count(); } })); },
};
const lines = [];
for (const name of Object.keys(ways)) {
  for (let round = 0; round < 3; round++) {
    const spread = fill({ a: 1 });
    ways[name](spread);
    let before = runs;
    const copy = { ...spread };
    const bySpread = runs - before;

    const listed = fill({ b: 1 });
    ways[name](listed);
    before = runs;
    const values = Object.values(listed);
    const byValues = runs - before;

    const entered = fill({ c: 1 });
    ways[name](entered);
    before = runs;
    const entries = Object.entries(entered);
    const byEntries = runs - before;

    const assigned = fill({ d: 1 });
    ways[name](assigned);
    before = runs;
    const target = Object.assign({}, assigned);
    const byAssign = runs - before;

    const written = fill({ e: 1 });
    ways[name](written);
    before = runs;
    const text = JSON.stringify(written);
    const byText = runs - before;
    if (round === 2) lines.push([name, bySpread, byValues, byEntries, byAssign, byText, Object.keys(copy).length, values.length, entries.length, Object.keys(target).length, text].join(" "));
  }
}
console.log(lines.join("\n"));
