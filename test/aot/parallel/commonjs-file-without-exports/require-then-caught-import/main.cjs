const table = { a: "./plain.cjs" };
function set(key, value) {
  table[key] = value;
}
set(process.argv[99] ?? "b", "./other.cjs");
async function load(wanted) {
  if (!wanted) return null;
  try {
    return require(table.a);
  } catch {
    return import(table.a);
  }
}
load(process.argv.length < 99).then(() => console.log("end"));
