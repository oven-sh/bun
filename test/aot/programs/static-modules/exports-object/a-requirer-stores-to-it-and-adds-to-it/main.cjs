// A requirer can store to the exports of another module and add to them.
const a = require("./a.cjs");
a.n = 5;
a.added = 1;
console.log(a.read(), Object.keys(a).join());
