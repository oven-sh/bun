const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
import.meta.require(table.a);
await import(table.a);
import.meta.require(table.a);
await import("./plain.cjs");
console.log("end");
