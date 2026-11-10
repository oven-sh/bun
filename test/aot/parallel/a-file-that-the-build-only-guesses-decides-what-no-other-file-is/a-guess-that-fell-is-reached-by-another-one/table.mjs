const table = { part: "./part.mjs", other: "./other.mjs" };
export const seen = JSON.stringify(table);
function load(go) {
  if (!go) return;
  import.meta.require(table.part);
  import.meta.require(table.other);
}
load(false);
