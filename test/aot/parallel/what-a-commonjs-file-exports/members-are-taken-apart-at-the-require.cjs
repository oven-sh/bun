const { pad, twice } = require("./lib-members.cjs");
function use(s, n) { return pad(s) + twice(n); }
let out = "";
for (let i = 0; i < 200; i++) out = use("b", i);
console.log(out);
