// table.json is given to the executable as an asset and lies beside table.js, which the program holds. Each answers to its own name, and "./table" is table.js, as in `bun run`.
// Flags: --asset ./table.json
console.log(require("./table.js").who);
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of ["./table.json", "./table"]) console.log(name, require(made(name)).who);
