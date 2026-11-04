import ledger from "./ledger.cjs";
export function look() { return typeof ledger.total + ":" + (ledger.total + 1); }
