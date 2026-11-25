const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
function load() {
  return import.meta.require(table.a);
}
load();
export function later() {
  return import("./plain.cjs");
}
console.log("end");
