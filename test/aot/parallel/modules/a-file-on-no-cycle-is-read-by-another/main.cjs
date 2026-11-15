const ledger = require("./ledger.cjs");
function total() { let sum = 0; for (let turn = 0; turn < 300; turn++) sum += ledger.first.length + require("./ledger.cjs").second; return sum; }
console.log(total(), ledger.read());
