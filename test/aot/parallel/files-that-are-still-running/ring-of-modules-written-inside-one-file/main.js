var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_ledger = __commonJS({
  "ledger.js"(exports) {
    const probe = require_probe();
    exports.first = probe.look();
    exports.total = 41;
    exports.second = probe.look();
  },
});
var require_probe = __commonJS({
  "probe.js"(exports) {
    exports.look = function () {
      const ledger = require_ledger();
      return typeof ledger.total + ":" + (ledger.total + 1);
    };
  },
});
const ledger = require_ledger();
console.log(ledger.first, ledger.second);
