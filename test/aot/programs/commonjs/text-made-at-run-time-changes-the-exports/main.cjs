// Text made at run time changes the exports.
const m = require("./m.cjs");
const change = new Function("o", "o.a = 'changed by text'; o.f = function () { return 'f by text'; }; delete o.b; o.c = 3;");
change(m);
console.log(m.a, m.f(), m.b, m.c, m.read(), Object.keys(m).join());
