// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
"use strict";
const attempts = [
  () => {
    globalThis.process = {};
  },
  () => {
    delete globalThis.process;
  },
  () => {
    Object.defineProperty(globalThis, "process", { value: 1 });
  },
  () => {
    process.isBun = false;
  },
  () => {
    delete process.isBun;
  },
  () => {
    process.versions = {};
  },
  () => {
    process.release = {};
  },
  () => {
    process.versions.bun = "0";
  },
  () => {
    delete process.versions.bun;
  },
  () => {
    process.versions.node = "0";
  },
  () => {
    delete process.versions.node;
  },
  () => {
    Object.defineProperty(process.versions, "node", { value: "0" });
  },
  () => {
    Object.assign(process.versions, { node: "0" });
  },
  () => {
    process.release.name = "other";
  },
  () => {
    delete process.release.name;
  },
];
const chosen = process.argv.length < 9 ? attempts : [];
const read = (object, key) => object[key];
for (const attempt of chosen) {
  try {
    attempt();
    console.log("done");
  } catch (error) {
    console.log(String(error).split(" (bun compile")[0]);
  }
}
console.log(
  Reflect.set(process.versions, "node", "0"),
  Reflect.deleteProperty(process.versions, "bun"),
  Reflect.defineProperty(process.release, "name", { value: "other" }),
);
console.log(
  typeof process,
  process.isBun,
  typeof process.versions.bun,
  "deno" in process.versions,
  process.release.name,
);
console.log(
  [read(process.versions, "bun"), read(process.versions, "node"), read(process.release, "name")].join() ===
    [process.versions.bun, process.versions.node, process.release.name].join(),
);
process.title = "mine";
process.mine = 1;
Bun.mine = 2;
console.log(process.mine, Bun.mine);
/* Output:
TypeError: Cannot assign to process because built-in objects are read-only in a compiled executable
TypeError: Cannot delete process because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to process because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to process.isBun because built-in objects are read-only in a compiled executable
TypeError: Cannot delete process.isBun because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to process.versions because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to process.release because built-in objects are read-only in a compiled executable
TypeError: Attempted to assign to readonly property.
TypeError: Unable to delete property.
TypeError: Attempted to assign to readonly property.
TypeError: Unable to delete property.
TypeError: Attempting to change value of a readonly property.
TypeError: Attempted to assign to readonly property.
TypeError: Attempted to assign to readonly property.
TypeError: Unable to delete property.
false false false
object true string false node
true
1 2
*/
