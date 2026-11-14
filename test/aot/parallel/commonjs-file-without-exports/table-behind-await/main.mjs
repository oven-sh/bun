const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
const loaded = import("./plain.cjs");
async function pick() {
  await loaded;
  import.meta.require(table.a);
}
pick().then(() => console.log("end"));
