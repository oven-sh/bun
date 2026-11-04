const ledger = require("./ledger.cjs");
export const seen = typeof ledger.total + ":" + (ledger.total + 1) + ":" + ledger.early;
