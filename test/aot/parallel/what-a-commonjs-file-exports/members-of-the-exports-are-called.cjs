const lib = require("./lib-members.cjs");
function use(s, n) { return lib.pad(s) + lib.twice(n) + lib.limit; }
let out = "";
for (let i = 0; i < 200; i++) out = use("a" + (i % 3), i);
console.log(out, Object.keys(lib).join());
