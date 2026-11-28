const table = { part: "./part.mjs" };
globalThis.kept = table;
async function go(key) {
  await null;
  await import(table[key]);
  require("./silent.cjs");
}
go(["part"][0]);
