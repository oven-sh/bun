// A wrapper that hands exports to its factory.
const t = require("./t.cjs");
console.log(Object.keys(t).join(), t.a, t.f());
