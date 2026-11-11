const table = { part: "./part.mjs" };
export const seen = Object.isFrozen(table);
export function later() {
  return import.meta.require(table.part);
}
