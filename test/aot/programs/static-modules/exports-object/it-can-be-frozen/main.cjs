// The exports object can be frozen, and a store in sloppy code then does nothing.
const a = require("./a.cjs");
console.log(a.x, a.y, Object.isFrozen(a));
