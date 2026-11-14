const make = require("./index.cjs");
const a = make({ step: 2 });
const b = make({ step: 5 });
a.twice();
b.twice();
console.log(a.twice(), b.twice(), a.read(), b.read());
