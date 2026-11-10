(function (global, factory) { typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.lib = {})); })(this, (function (exports) { "use strict";
  function add(a, b) { return a + b; }
  exports.add = add;
  Object.defineProperty(exports, "__esModule", { value: true });
}));
const lib = module.exports;
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), lib.__esModule, Object.keys(lib).join());
