// Names out of written lists are keys of reads, stores, definitions and calls; the lists are changed, shared, frozen, copied and emptied behind their birth.
const table = { run: 1, stop: 2, toString: 3 };
const names = ["run", "stop"];
function read(i) {
  return table[names[i]];
}
console.log(read(0), read(1), read(2));
names.push("toString");
console.log(read(2));
names[0] = "valueOf";
console.log(typeof read(0));
names[1] = "written" + "-at-run-time".slice(0, 3);
console.log(read(1));
names.length = 0;
console.log(read(0));

const inherited = ["run", "hasOwnProperty", "__proto__", "constructor"];
for (const name of inherited) console.log(name, typeof table[name], name in table, Object.hasOwn(table, name));

const sink = {};
for (const name of ["a", "b", "__proto__", "constructor", "a"]) sink[name] = name.length;
console.log(JSON.stringify(sink), Object.keys(sink).join(), Object.getPrototypeOf(sink) === Object.prototype);

class Route {
  counts = { get: 0, post: 0, head: 0 };
}
const verbs = ["get", "post", "head"];
verbs.forEach(function (verb) {
  Route.prototype[verb] = function (by) {
    this.counts[verb] += by;
    return this;
  };
});
const route = new Route();
route.get(1).post(2).head(3).get(4);
console.log(JSON.stringify(route.counts), Object.keys(Route.prototype).join());
verbs.push("trace");
console.log(typeof route[verbs[3]], typeof route[verbs[0]]);
Route.prototype[verbs[0]] = () => "replaced";
console.log(route.get(1), route[verbs[1]](5).counts.post);

const handlers = {
  up: n => n + 1,
  down: n => n - 1,
};
const script = ["up", "down", "up", "sideways"];
for (const step of script) {
  try {
    console.log(step, handlers[step](10));
  } catch (error) {
    console.log(step, error instanceof TypeError);
  }
}

const mixed = ["run", 1, null, undefined, true, "stop", 2.5, ["run"], { run: "stop" }];
for (const key of mixed) console.log(String(key), table[key]);
console.log(table[mixed[7][0]], table[mixed[8].run]);

const holes = ["run", , "stop"];
console.log(table[holes[0]], table[holes[1]], table[holes[2]], 1 in holes);

const frozen = Object.freeze(["run", "stop"]);
try {
  "use strict";
  frozen[0] = "toString";
} catch {}
console.log(table[frozen[0]]);

const copies = [...["run", "stop"], ...["toString"]].concat(["missing"]).map(name => table[name]);
console.log(copies.join());
const upper = ["run", "stop"].map(name => name.toUpperCase());
console.log(table[upper[0]], table[upper[0].toLowerCase()]);

function fill(target, list) {
  for (let i = 0; i < list.length; i++) Object.defineProperty(target, list[i], { get: () => list[i] + i, enumerable: true, configurable: true });
  return target;
}
const filled = fill({}, ["id", "size"]);
console.log(filled.id, filled.size, JSON.stringify(filled));
const other = fill({ id: 0 }, ["size", "rank"]);
console.log(other.id, other.size, other.rank);

const removed = { run: 1, stop: 2, keep: 3 };
for (const name of ["run", "stop", "absent"]) delete removed[name];
console.log(JSON.stringify(removed));

const symbols = { [Symbol.iterator]: 1, iterator: 2 };
console.log(symbols[["iterator"][0]], symbols[[Symbol.iterator][0]]);
const numeric = { 0: "zero", 1: "one", "01": "text" };
for (const key of ["0", "1", "01", "-0"]) console.log(key, numeric[key]);
const list = ["a", "b"];
for (const key of ["0", "1", "length", "2"]) console.log(key, list[key]);
