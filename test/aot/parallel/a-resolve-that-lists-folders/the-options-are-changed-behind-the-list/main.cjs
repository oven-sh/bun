const { join } = require("node:path");
const paths = [join(__dirname, "second"), __dirname];
const options = { paths };
options.paths = [__dirname];
const found = require.resolve("./part.cjs", options);
console.log("SAID", found.slice(__dirname.length), require(found).name);
