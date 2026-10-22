function replacement() {
  return "replaced";
}

const fast = {
  push: list => list.push(9),
  pop: list => list.pop(),
  shift: list => list.shift(),
  unshift: list => list.unshift(9),
  slice: list => list.slice(),
  splice: list => list.splice(0, 1),
  concat: list => list.concat([9]),
  map: list => list.map(value => value),
  filter: list => list.filter(value => value),
  forEach: list => list.forEach(value => value),
  reduce: list => list.reduce((total, value) => total + value, 0),
  sort: list => list.sort((a, b) => a - b),
  reverse: list => list.reverse(),
  indexOf: list => list.indexOf(1),
  includes: list => list.includes(1),
  find: list => list.find(value => value === 1),
  some: list => list.some(value => value === 1),
  every: list => list.every(value => value === 1),
  join: list => list.join(),
  fill: list => list.fill(0),
  at: list => list.at(0),
  flat: list => list.flat(),
  keys: list => list.keys(),
  entries: list => list.entries(),
  toString: list => list.toString(),
};

const spelled = {};
for (const name of ["Array", ...Object.keys(fast)]) spelled[name] = name.split("").join("");

const ways = {
  "a store": name => { Array.prototype[name] = replacement; },
  "a store through an instance": name => { [].__proto__[name] = replacement; },
  "a store through the global object": name => { globalThis[spelled.Array].prototype[name] = replacement; },
  "Reflect.set": name => Reflect.set(Array.prototype, name, replacement),
  "Object.defineProperty": name => { Object.defineProperty(Array.prototype, name, { value: replacement }); },
  "Object.assign": name => { Object.assign(Array.prototype, { [name]: replacement }); },
  "a getter": name => { Object.defineProperty(Array.prototype, name, { get: () => replacement, configurable: true }); },
  "a deletion": name => { delete Array.prototype[name]; },
};

const spelledStores = {
  push: () => { Array.prototype.push = replacement; },
  map: () => { Array.prototype.map = replacement; },
  sort: () => { Array.prototype.sort = replacement; },
  join: () => { Array.prototype.join = replacement; },
  forEach: () => { Array.prototype.forEach = replacement; },
};

function outcome(run) {
  try {
    return run() === "replaced" ? "replaced" : "original";
  } catch (error) {
    return "missing";
  }
}

function observe(name) {
  return [
    outcome(() => fast[name]([1, 2, 3])),
    outcome(() => [1, 2, 3][spelled[name]](() => 0)),
    outcome(() => Reflect.get(Array.prototype, name).call([1, 2, 3], () => 0)),
    outcome(() => Object.getPrototypeOf([])[name].call([1, 2, 3], () => 0)),
  ];
}

for (const name in fast) for (let i = 0; i < 1000; i++) fast[name]([1, 2, 3]);

function trial(label, name, change) {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name);
  try {
    change(name);
  } catch {}
  const during = observe(name);
  try {
    Object.defineProperty(Array.prototype, name, descriptor);
  } catch {}
  const after = observe(name);
  const agreed = during.every(answer => answer === during[0]);
  const restored = after.every(answer => answer === "original");
  console.log((agreed && restored ? "ok " : "WRONG ") + label + ", " + name + (agreed ? ": every caller saw the same method" : ": callers saw " + during.join()) + (restored ? ", and the original afterwards" : ", and afterwards " + after.join()));
}

for (const way in ways) for (const name in fast) trial(way, name, ways[way]);
for (const name in spelledStores) trial("a store that spells the name", name, spelledStores[name]);

Array.prototype.lastOne = function () {
  return this[this.length - 1];
};
console.log("a method under a new name: " + [1, 2, 3].lastOne() + ", " + Object.keys([1]).join() + ", " + ("lastOne" in []));
const seen = [];
for (const key in [7]) seen.push(key);
console.log("for-in sees " + seen.join());
const removed = Reflect.deleteProperty(Array.prototype, "lastOne");
console.log((typeof [].lastOne === (removed ? "undefined" : "function") ? "ok " : "WRONG ") + "after its deletion a lookup agrees with what the deletion answered");
