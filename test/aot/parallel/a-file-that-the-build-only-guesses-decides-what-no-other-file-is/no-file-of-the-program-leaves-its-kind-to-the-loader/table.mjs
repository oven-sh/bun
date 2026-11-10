const table = { part: "./part.mjs", other: "./other.cjs" };
export const seen = JSON.stringify(table);
export const later = key => import.meta.require(table[key]);
