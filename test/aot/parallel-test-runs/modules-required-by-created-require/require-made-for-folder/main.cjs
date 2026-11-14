const { createRequire } = require("node:module");
const path = require("node:path");
const made = createRequire(path.join(__dirname, "other/file.js"));
const one = made("../a.cjs");
const two = require("./a.cjs");
console.log("SAID", tree(module), one === two, one.parent);
