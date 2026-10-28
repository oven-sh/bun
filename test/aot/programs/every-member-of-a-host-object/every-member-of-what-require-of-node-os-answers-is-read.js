// Every way to go over the members of what require("node:os") answers reads each of them, and no read throws: what plain Bun answers is answered.
const os = require("node:os");

const kindOf = read => {
  try {
    return typeof read();
  } catch (error) {
    return "throws " + error.message;
  }
};
const digest = pairs => {
  const counts = {};
  const thrown = [];
  for (const [key, kind] of pairs) {
    if (kind.startsWith("throws")) thrown.push(String(key) + ": " + kind);
    else counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return JSON.stringify(counts) + " " + JSON.stringify(thrown);
};

console.log("keys", digest(Object.keys(os).map(key => [key, kindOf(() => os[key])])));
console.log("values", kindOf(() => Object.values(os).length));
console.log("entries", kindOf(() => Object.entries(os).length));
console.log("spread", kindOf(() => ({ ...os })));
console.log("assign", kindOf(() => Object.assign({}, os)));
const inLoop = [];
for (const key in os) inLoop.push([key, kindOf(() => os[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(os).map(key => [key, kindOf(() => Reflect.get(os, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(os)));
console.log("JSON", kindOf(() => JSON.stringify(os)));
