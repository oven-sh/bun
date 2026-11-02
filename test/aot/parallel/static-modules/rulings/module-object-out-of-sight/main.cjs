// A `module` object that the compiler loses sight of keeps its `exports`, its `children` and its `parent`.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const child = require("./child.cjs");
console.log(child.seen);
