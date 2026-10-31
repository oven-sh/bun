// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import imported from "node:process";
function ask(name) {
  return [
    process.versions[name],
    name in process.versions,
    typeof process.versions[name],
    Object.hasOwn(process.versions, name),
  ].join();
}
function electron() {
  return [process.versions.electron, "electron" in process.versions, process.versions?.electron ?? "none"].join();
}
console.log(ask("pnp"), electron(), Object.isExtensible(process.versions), Object.isExtensible(process.release));
process.versions.pnp = String(3);
process.versions.electron = "30.0.0";
process.release.lts = "Iron";
console.log(
  ask("pnp"),
  electron(),
  process.release.lts,
  "lts" in process.release,
  Object.keys(process.release).join(),
  Object.keys(process.versions).slice(-2).join(),
);
delete process.versions.electron;
console.log(electron());
Object.defineProperty(process.versions, "hidden", { value: 7, enumerable: false, configurable: true, writable: true });
process.versions.hidden++;
console.log(
  process.versions.hidden,
  Object.keys(process.versions).includes("hidden"),
  JSON.stringify(Object.getOwnPropertyDescriptor(process.versions, "hidden")),
);
Object.assign(process.versions, { one: 1, two: "2" });
process.versions[Symbol.for("mine")] = 3;
process.versions[5] = "five";
console.log(process.versions.one + 1, process.versions.two, process.versions[Symbol.for("mine")], process.versions[5]);
const { versions, release } = process;
function put(object, key, value) {
  object[key] = value;
  return object[key];
}
console.log(
  put(versions, "x", 1),
  put(release, "y", [2])[0],
  put({}, "z", 3),
  process.versions.x,
  process.release.y[0],
);
imported.versions.viaImport = true;
console.log(process.versions.viaImport, globalThis.process.versions === versions);
let sum = 0;
for (const key in process.versions) if (typeof process.versions[key] === "number") sum += process.versions[key];
console.log(sum, typeof process.versions.bun, typeof process.versions.node, process.release.name);
