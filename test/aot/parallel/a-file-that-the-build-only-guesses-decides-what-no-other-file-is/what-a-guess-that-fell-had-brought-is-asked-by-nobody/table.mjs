const table = { part: "./part.mjs" };
export const seen = JSON.stringify(table);
function load(go) {
  if (!go) return;
  return import.meta.require(table.part);
}
load(false);
