const { join } = require("node:path");
const second = join(__dirname, "second");
console.log("SAID", require.resolve("./part.cjs", { paths: [second, __dirname] }).replace(__dirname, ""));
console.log("SAID", require(require.resolve("./part.cjs", { paths: [second, __dirname] })).name);
console.log("SAID", require.resolve("./part.cjs", { paths: [__dirname, second] }).replace(__dirname, ""));
