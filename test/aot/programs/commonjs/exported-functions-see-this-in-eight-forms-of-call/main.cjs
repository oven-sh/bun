// Exported functions see this in eight forms of call.
const m = require("./m.cjs");
const { who, arrow } = m;
console.log(m.who() === m, who() === undefined || who() === globalThis, m.arrow() === m, arrow() === m, m.who.call(5) == 5, (0, m.who)() === m, m["who"]() === m, (m.who)() === m);
console.log(m.count(), m.count(), m.n);
