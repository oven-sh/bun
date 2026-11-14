const Base = require("./lib-class.cjs");
class More extends Base { add(i) { return super.add(i * 2); } }
function total(n) { let sum = 0; for (let i = 0; i < n; i++) sum += new More().add(i).n; return sum; }
console.log(total(500), new More() instanceof Base);
