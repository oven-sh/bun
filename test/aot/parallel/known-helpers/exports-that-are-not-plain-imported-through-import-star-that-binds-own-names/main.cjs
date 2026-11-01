// What TypeScript 5.7 to 6.0 writes around a require, of exports that another file has changed ahead of the import: a marker that is a getter and answers otherwise the second time, takes itself away, takes names away or changes what stands above the exports; exports below a proxy, whose traps are listed; a marker with a value; names that are fixed, frozen, accessors or hidden from a walk.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const log = (globalThis.log = []);
require("./before.cjs");
const changes = __importStar(require("./changes.cjs"));
const removes_itself = __importStar(require("./removes-itself.cjs"));
const removes_names = __importStar(require("./removes-names.cjs"));
const changes_what_is_above = __importStar(require("./changes-what-is-above.cjs"));
const below_a_proxy = __importStar(require("./below-a-proxy.cjs"));
const marked_zero = __importStar(require("./marked-zero.cjs"));
const marked_true = __importStar(require("./marked-true.cjs"));
const fixed = __importStar(require("./fixed.cjs"));
const frozen = __importStar(require("./frozen.cjs"));
const accessor = __importStar(require("./accessor.cjs"));
const hidden = __importStar(require("./hidden.cjs"));
const untouched = __importStar(require("./untouched.cjs"));
function show() {
  console.log("changes:", changes.value, changes.other, changes.who(), (0, changes.who)(), typeof changes.default, changes.inherited, log.splice(0).join(", "));
  console.log("removes-itself:", removes_itself.value, removes_itself.other, removes_itself.who(), (0, removes_itself.who)(), typeof removes_itself.default, removes_itself.inherited, log.splice(0).join(", "));
  console.log("removes-names:", removes_names.value, removes_names.other, removes_names.who(), (0, removes_names.who)(), typeof removes_names.default, removes_names.inherited, log.splice(0).join(", "));
  console.log("changes-what-is-above:", changes_what_is_above.value, changes_what_is_above.other, changes_what_is_above.who(), (0, changes_what_is_above.who)(), typeof changes_what_is_above.default, changes_what_is_above.inherited, log.splice(0).join(", "));
  console.log("below-a-proxy:", below_a_proxy.value, below_a_proxy.other, below_a_proxy.who(), (0, below_a_proxy.who)(), typeof below_a_proxy.default, below_a_proxy.inherited, log.splice(0).join(", "));
  console.log("marked-zero:", marked_zero.value, marked_zero.other, marked_zero.who(), (0, marked_zero.who)(), typeof marked_zero.default, marked_zero.inherited, log.splice(0).join(", "));
  console.log("marked-true:", marked_true.value, marked_true.other, marked_true.who(), (0, marked_true.who)(), typeof marked_true.default, marked_true.inherited, log.splice(0).join(", "));
  console.log("fixed:", fixed.value, fixed.other, fixed.who(), (0, fixed.who)(), typeof fixed.default, fixed.inherited, log.splice(0).join(", "));
  console.log("frozen:", frozen.value, frozen.other, frozen.who(), (0, frozen.who)(), typeof frozen.default, frozen.inherited, log.splice(0).join(", "));
  console.log("accessor:", accessor.value, accessor.other, accessor.who(), (0, accessor.who)(), typeof accessor.default, accessor.inherited, log.splice(0).join(", "));
  console.log("hidden:", hidden.value, hidden.other, hidden.who(), (0, hidden.who)(), typeof hidden.default, hidden.inherited, log.splice(0).join(", "));
  console.log("untouched:", untouched.value, untouched.other, untouched.who(), (0, untouched.who)(), typeof untouched.default, untouched.inherited, log.splice(0).join(", "));
}
show();
for (const name of ["changes", "removes-itself", "removes-names", "changes-what-is-above", "below-a-proxy", "marked-zero", "marked-true", "fixed", "frozen", "accessor", "hidden", "untouched"]) {
  const real = require("./" + name + ".cjs");
  for (const change of [() => (real.value = "stored behind the import"), () => delete real.other, () => (real.other = "stored again"), () => (real.who = function () { return this === real ? "the exports, by another function" : "another object, by another function"; })]) {
    try {
      change();
    } catch (error) {
      log.push(error.constructor.name);
    }
  }
}
show();
