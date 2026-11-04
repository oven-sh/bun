// Entry points: ./modules/a.cjs ./modules/b.cjs
const which = globalThis.never ? "a" : "b";
const table = { a: "./modules/a.cjs", b: "./modules/b.cjs" };
const found = require(table[which]);
console.log(found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
