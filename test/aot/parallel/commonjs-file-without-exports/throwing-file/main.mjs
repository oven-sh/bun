const table = { a: "./thrower.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
const told = [];
const waits = import("./thrower.cjs");
try {
  import.meta.require(table.a);
} catch (error) {
  told.push("required: " + error.message);
}
try {
  await waits;
} catch (error) {
  told.push("imported: " + error.message);
}
console.log(told.join(", "));
