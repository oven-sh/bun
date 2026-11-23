function read(early) {
  const ledger = require("./ledger.cjs");
  return early ? String(ledger.early) : String(ledger.late);
}
try {
  read(true);
} catch (e) {
  console.log("caught", e.message);
}
console.log(read(true), "|", read(false));
