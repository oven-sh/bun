// What require.cache lists does not go through a method that a program can reach on Array.prototype.
let calls = 0;
function countCalls() {
  calls++;
  return [];
}
const names = ["filter", "map", "push", "concat", "slice"];
const methods = names.map(name => Array.prototype[name]);
require.cache["/made/by/the/program.js"] = { id: "made", exports: {} };
for (const name of names) {
  try {
    Array.prototype[name] = countCalls;
  } catch {}
}
const listed = { keys: false, names: false, walked: false };
for (const key of Object.keys(require.cache)) listed.keys ||= key === "/made/by/the/program.js";
for (const key of Reflect.ownKeys(require.cache)) listed.names ||= key === "/made/by/the/program.js";
for (const key in require.cache) listed.walked ||= key === "/made/by/the/program.js";
const callsWhileListing = calls;
for (let index = 0; index < names.length; index++) {
  try {
    Array.prototype[names[index]] = methods[index];
  } catch {}
}
console.log(listed.keys, listed.names, listed.walked, callsWhileListing);
