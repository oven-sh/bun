const f = require("./lib-by-a-made-up-key.cjs");
function call() { return f(); }
let out = "";
for (let i = 0; i < 100; i++) out = call();
console.log(out, f.name);
