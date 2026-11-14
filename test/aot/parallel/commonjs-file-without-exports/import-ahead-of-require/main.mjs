const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
await import("./plain.cjs");
import.meta.require(table.a);
console.log("end");
