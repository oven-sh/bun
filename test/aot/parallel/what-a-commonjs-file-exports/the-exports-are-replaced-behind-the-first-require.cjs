const before = require("./lib-replaces-itself.cjs");
function call(f) { return f(); }
let sum = 0;
for (let i = 0; i < 100; i++) sum += call(before);
before.swap();
const after = require("./lib-replaces-itself.cjs");
for (let i = 0; i < 100; i++) sum += call(after);
console.log(sum, before === after, before.name, after.name);
