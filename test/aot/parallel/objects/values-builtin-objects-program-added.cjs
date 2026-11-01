// Built-ins that take the own values of a built-in object find what the program has put on it: under a name, through a reference that may be another object, and by a copy.
const calls = [];
const note = name => function () { calls.push(name + ":" + (this === undefined ? "undefined" : typeof this)); return name; };
Map.prototype.underName = note("underName");
const holders = [Set.prototype, {}];
const chosen = holders[process.argv.length > 100 ? 1 : 0];
const key = process.argv.length > 100 ? "other" : "underKey";
chosen[key] = note("underKey");
Object.assign(WeakMap.prototype, { copied: note("copied") });
for (const holder of [Map.prototype, Set.prototype, WeakMap.prototype]) {
  for (const value of Object.values(holder)) console.log(typeof value, value.call(holder));
  for (const [name, value] of Object.entries(holder)) console.log(name, value());
  const copy = { ...holder };
  console.log(Object.keys(copy).join(), Object.keys(Object.assign({}, holder)).join());
  for (const name in copy) console.log(copy[name].call(1));
}
console.log(calls.join());
console.log(Object.values(Reflect).length, Object.values(Math).length, Object.values(JSON).length, Object.values(Object.prototype).length);
console.log(new Map([[1, { a: 2 }]]), new Set(["x"]), require("node:util").inspect(new Map([["k", new Set([1])]])));
console.log((0, eval)(process.argv[9] || "1 + 1"));
