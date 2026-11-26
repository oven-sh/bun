const table = { part: "./part.mjs" };
export const seen = JSON.stringify(table);
export const found = import.meta.require(table.part);
