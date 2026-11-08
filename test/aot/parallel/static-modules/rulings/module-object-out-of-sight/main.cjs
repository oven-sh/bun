// A `module` object that the compiler loses sight of keeps its `exports`, its `children` and its `parent`.
const child = require("./child.cjs");
console.log(child.seen);
