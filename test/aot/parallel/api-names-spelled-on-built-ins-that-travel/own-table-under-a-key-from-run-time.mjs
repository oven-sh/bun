const table = { first: Bun, second: Bun };
const k = process.argv.length > 99 ? "first" : ["sec", "ond"].join("");
console.log(table[k].escapeHTML("<a>"));
