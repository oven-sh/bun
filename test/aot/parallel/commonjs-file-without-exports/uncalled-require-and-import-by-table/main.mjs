const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
export function pick() {
  return import.meta.require(table.a);
}
await import(table.a);
console.log("end");
