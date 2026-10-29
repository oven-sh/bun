// Object.defineProperty(exports, name, { value }) makes a property that takes no store, from another file either: sloppy code goes on, strict code throws.
const m = require("./m.cjs");
m.x = 2;
m.y = 2;
console.log(m.x, m.y, m.read());
console.log(require("./strict.cjs"), m.x);
