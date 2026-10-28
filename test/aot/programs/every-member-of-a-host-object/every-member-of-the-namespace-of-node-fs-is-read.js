// Every way to go over the members of the namespace of node:fs reads each of them, and no read throws: what plain Bun answers is answered.
import * as fs from "node:fs";

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

console.log("keys", digest(Object.keys(fs).map(key => [key, kindOf(() => fs[key])])));
console.log("values", kindOf(() => Object.values(fs).length));
console.log("entries", kindOf(() => Object.entries(fs).length));
console.log("spread", kindOf(() => ({ ...fs })));
console.log("assign", kindOf(() => Object.assign({}, fs)));
const inLoop = [];
for (const key in fs) inLoop.push([key, kindOf(() => fs[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(fs).map(key => [key, kindOf(() => Reflect.get(fs, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(fs)));
console.log("JSON", kindOf(() => JSON.stringify(fs)));
