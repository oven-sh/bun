var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_ledger = __commonJS((exports) => {
  const probe = require_probe();
  exports.first = probe.seen;
  exports.total = 41;
});
var require_probe = __commonJS((exports) => {
  const ledger = require_ledger();
  exports.seen = typeof ledger.total + ":" + (ledger.total + 1);
});
const ledger = require_ledger();
console.log(ledger.first, ledger.total);
