// An async function called where it is written stores to exports behind an await.
const m = require("./m.cjs");
console.log(m.a, m.b, Object.keys(m).join());
m.done.then(() => console.log(m.a, m.b, Object.keys(m).join()));
