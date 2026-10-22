// `var a = b; var b = a`: each variable is initialized with the other and both hold undefined.
const m = require("./m.cjs");
console.log(m.x, m.y, Object.keys(m).join());
console.log(JSON.stringify(Object.entries(require("./literal.cjs"))));
