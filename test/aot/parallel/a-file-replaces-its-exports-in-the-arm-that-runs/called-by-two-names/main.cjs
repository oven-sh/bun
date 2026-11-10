const make = require("./index.cjs");
const a = make({ step: 2 });
const b = make.default({ step: 7 });
a.twice();
b.twice();
console.log(a.read(), b.read());
