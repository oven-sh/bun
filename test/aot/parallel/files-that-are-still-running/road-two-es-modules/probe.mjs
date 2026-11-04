export function look() { const ledger = require("./ledger.cjs"); return typeof ledger.total + ":" + (ledger.total + 1); }
