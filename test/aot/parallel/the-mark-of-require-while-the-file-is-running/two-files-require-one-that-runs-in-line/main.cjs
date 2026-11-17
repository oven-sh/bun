function show(v) { return typeof v + ":" + String(v); }
const a = require("./one.cjs"), b = require("./two.cjs");
console.log("SAID two files", a.mark, b.mark, a.kit === b.kit);
