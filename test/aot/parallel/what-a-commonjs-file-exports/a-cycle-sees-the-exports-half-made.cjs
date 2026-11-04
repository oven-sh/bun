const one = require("./lib-cycle-one.cjs");
const two = require("./lib-cycle-two.cjs");
function all() { return one.early() + " | " + one.late() + " | " + two.ask(); }
let out = "";
for (let i = 0; i < 100; i++) out = all();
console.log(out);
