const { join } = require("node:path");
const paths = [join(__dirname, "second"), __dirname];
const found = require.resolve("./part.cjs", { paths });
console.log("SAID", found.slice(__dirname.length), require(found).name);
