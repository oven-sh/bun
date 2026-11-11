const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
if (process.argv.length > 99) import.meta.require(table.a);
import("./plain.cjs").then(() => console.log("end"));
