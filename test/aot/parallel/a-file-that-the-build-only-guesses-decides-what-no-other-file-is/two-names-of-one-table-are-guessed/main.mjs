const table = { part: "./part.mjs", other: "./other.cjs" };
export const seen = JSON.stringify(table);
console.log("SAID", import.meta.require(table.other));
if (process.argv.length > 99) import.meta.require(table.part);
await import("./silent.cjs");
