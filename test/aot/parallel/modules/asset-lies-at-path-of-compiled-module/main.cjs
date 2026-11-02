// The folder `data` is embedded with --asset, and one file of it is a further entry point too. require() finds the compiled module, and node:fs and Bun.file() read the bytes of the file.
// Flags: --asset ./data
// Entry points: ./data/page.js
const fs = require("node:fs");
const path = require("node:path");
const at = name => path.join(__dirname, "data", name);
console.log(require(at(["page", "js"].join("."))).name);
console.log(fs.readFileSync(at("page.js"), "utf8").trim());
console.log(fs.statSync(at("page.js")).size, fs.existsSync(at("page.js")), fs.readFileSync(at("note.txt"), "utf8").trim());
console.log(fs.readdirSync(at("")).sort().join());
Bun.file(at("page.js"))
  .text()
  .then(text => console.log(text.length));
