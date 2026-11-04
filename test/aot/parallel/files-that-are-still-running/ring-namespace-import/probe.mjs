import * as book from "./ledger.cjs";
export function look() { return typeof book.total + ":" + (book.total + 1) + ":" + typeof book.default.total; }
