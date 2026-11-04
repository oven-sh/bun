const Chosen = require("./lib-one-of-two.cjs");
function name() { return new Chosen().name(); }
let out = "";
for (let i = 0; i < 100; i++) out = name();
console.log(out, Chosen.name);
