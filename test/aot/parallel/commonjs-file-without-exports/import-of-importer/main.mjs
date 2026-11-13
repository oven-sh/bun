const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
function pick(go) {
  if (!go) return;
  import.meta.require(table.a);
}
pick(false);
await import("./imports.mjs");
console.log("end");
