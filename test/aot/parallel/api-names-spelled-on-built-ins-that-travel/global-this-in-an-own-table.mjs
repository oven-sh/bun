const table = { self: globalThis };
const k = process.argv.length > 99 ? "none" : ["se", "lf"].join("");
console.log(table[k].Bun.escapeHTML("<a>"));
