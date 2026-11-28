const table = { part: "./part.mjs" };
export const seen = JSON.stringify(table);
export const later = () => import.meta.require(table.part);
