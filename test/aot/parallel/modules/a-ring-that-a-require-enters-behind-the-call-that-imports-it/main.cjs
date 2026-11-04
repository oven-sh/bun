// A require() does not wait for a call of import() that came in front of it: it enters the ring at the file that it names, before it returns.
const first = import("./a.mjs");
first.then(() => console.log("the call settled"));
const b = require("./b.mjs");
console.log("require returned " + b.b);
first.then(() => console.log("loaded"));
