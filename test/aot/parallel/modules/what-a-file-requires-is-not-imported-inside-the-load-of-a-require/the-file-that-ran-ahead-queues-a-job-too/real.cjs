console.log("real begins");
const side = require("./side.mjs");
queueMicrotask(() => console.log("job of real"));
console.log("real ends", side.word);
exports.present = 1;
