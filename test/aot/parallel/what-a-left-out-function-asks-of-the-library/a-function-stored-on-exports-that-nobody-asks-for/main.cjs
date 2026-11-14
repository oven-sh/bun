// A CommonJS file stores two functions on its exports. One of them is asked for.
const { isMarked } = require("./marks.cjs");
console.log(String(isMarked(Object.prototype)), String(isMarked(Array.prototype)));
