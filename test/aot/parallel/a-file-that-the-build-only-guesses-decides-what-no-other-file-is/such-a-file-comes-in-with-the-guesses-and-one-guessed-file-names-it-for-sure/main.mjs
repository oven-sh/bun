const table = { first: "./first.cjs", silent: "./silent.cjs" };
export const seen = JSON.stringify(table);
function load(go, key) {
  if (!go) return;
  return import.meta.require(table[key]);
}
load(false, "first");
await import(table.silent);
