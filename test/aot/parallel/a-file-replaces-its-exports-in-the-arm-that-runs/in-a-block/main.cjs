const make = require("./index.cjs");
const a = make({ step: 2 });
a.twice();
console.log(a.twice(), a.read());
