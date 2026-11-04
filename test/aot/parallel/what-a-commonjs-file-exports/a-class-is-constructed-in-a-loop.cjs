const Required = require("./lib-class.cjs");
function total(n) { let sum = 0; for (let i = 0; i < n; i++) sum += new Required().add(i).add(1).n; return sum; }
console.log(total(10), total(1000), Required.name, typeof Required);
