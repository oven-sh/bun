// The build names what a file is under a type by a query. A query that the program makes finds no such text: what it asks for is the file or an error.
const { size } = require("./text.mjs");
const made = process.argv.length > 90 ? "x" : ["./rows", "json"].join(".");
const isText = rows => typeof rows === "string" || typeof (rows.default ?? rows) === "string";
let required = false;
try {
  required = isText(require(made + "?text"));
} catch {}
console.log(size > 0, "required text", required);
import(made + "?text").then(isText, () => false).then(imported => console.log("imported text", imported));
