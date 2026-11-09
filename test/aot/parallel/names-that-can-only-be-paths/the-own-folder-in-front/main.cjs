// `__dirname` in front of a name makes it a path from the root: no module of the library is called so.
// STATISTIC: FunctionsLowered <= 700
const name = process.argv[5] ?? "one";
console.log(require(__dirname + "/part-" + name + ".cjs"), require(`${__dirname}/part-${name}.cjs`));
