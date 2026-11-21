// A require() reads its type from a constant as from a string.
const kind = "file";
let words = "text";
const path = require("./part.mjs", { type: kind });
const text = require("./notes.mjs", { type: words });
const data = require("./rows.json", { type: "te" + "xt" });
console.log(typeof path, Object.keys(text).join(), typeof data.default, globalThis.ran ?? 0);
