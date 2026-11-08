// What `path.join` makes of `__dirname` is a path from the root. The load asks the text for that, since the run calls what it finds under `join`.
// STATISTIC: FunctionsLowered <= 700
const path = require("node:path");
const name = process.argv[5] ?? "one";
console.log(require(path.join(__dirname, "part-" + name + ".cjs")));
