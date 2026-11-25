const make = require("./index.cjs");
const a = make({ step: 2, depth: 2 });
a.twice();
a.inner.twice();
a.inner.inner.twice();
console.log(a.read(), a.inner.read(), a.inner.inner.read());
