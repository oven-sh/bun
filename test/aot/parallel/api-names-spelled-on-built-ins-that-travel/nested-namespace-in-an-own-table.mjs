const table = { first: Bun.semver };
const k = process.argv.length > 99 ? "none" : ["fir", "st"].join("");
console.log(table[k].satisfies("1.2.3", "^1.0.0"));
