const f = require("./lib-getter.cjs");
function call() { return f(); }
let out = "";
for (let i = 0; i < 50; i++) out = call();
console.log(typeof out, typeof f, f.name);
