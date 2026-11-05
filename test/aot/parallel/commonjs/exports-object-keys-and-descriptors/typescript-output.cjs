"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.raised = exports.renamed = exports.Zeta = exports.DELTA = exports.Gamma = exports.BETA = exports.ALPHA = exports.two = exports.uno = void 0;
exports.epsilon = epsilon;
exports.raise = raise;
var through_module_exports_cjs_1 = require("./through-module-exports.cjs");
Object.defineProperty(exports, "uno", { enumerable: true, get: function () { return through_module_exports_cjs_1.one; } });
Object.defineProperty(exports, "two", { enumerable: true, get: function () { return through_module_exports_cjs_1.two; } });
exports.ALPHA = "alpha";
exports.BETA = 2;
class Gamma {}
exports.Gamma = Gamma;
function epsilon(n) {
  return n + 1;
}
var DELTA;
(function (DELTA) {
  DELTA[(DELTA["One"] = 1)] = "One";
})(DELTA || (exports.DELTA = DELTA = {}));
var Zeta;
(function (Zeta) {
  Zeta.inner = exports.ALPHA;
})(Zeta || (exports.Zeta = Zeta = {}));
const local = exports.BETA + 1;
exports.renamed = local;
function raise() {
  return ++exports.BETA;
}
exports.raised = raise();
exports.default = epsilon;
