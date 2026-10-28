// Every way to go over the members of the namespace of node:util reads each of them, and no read throws: what plain Bun answers is answered.
import * as util from "node:util";

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

console.log("keys", digest(Object.keys(util).map(key => [key, kindOf(() => util[key])])));
console.log("values", kindOf(() => Object.values(util).length));
console.log("entries", kindOf(() => Object.entries(util).length));
console.log("spread", kindOf(() => ({ ...util })));
console.log("assign", kindOf(() => Object.assign({}, util)));
const inLoop = [];
for (const key in util) inLoop.push([key, kindOf(() => util[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(util).map(key => [key, kindOf(() => Reflect.get(util, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(util)));
console.log("JSON", kindOf(() => JSON.stringify(util)));
