const { test } = require("bun:test");
const dual = require("dual");
test("a CommonJS test file", () => { console.log("SEEN|f|a CommonJS test file|" + JSON.stringify([dual.kind, require("plain-dep").name, typeof module.exports, __filename.split("/").pop(), require.main === module])); });
