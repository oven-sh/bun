// A file that uses its own `arguments` could have replaced `require`, so only flow sees the read of `main`. A require under a computed name loads a file of the executable: nothing the build has not seen.
// Entry points: ./other.cjs
const made = require("node:module").createRequire(__filename);
console.log(arguments.length, typeof made.main, made.main === module);
console.log(require(process.argv[2] ?? "./" + ["other", "cjs"].join(".")));
