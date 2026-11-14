// A barrel whose object is shown reads the modules behind it by name: they keep their names.
// COUNTER: SiteCacheEntriesAllocated <= 1
(() => {
"use strict";
var __webpack_modules__ = ({
/***/ "./a.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* binding */ f),
  C: () => (/* binding */ C),
  count: () => (/* binding */ count),
  "default": () => (__WEBPACK_DEFAULT_EXPORT__)
});
let count = 0; function f(x) { count++; return "f" + x; }
class C { constructor(n) { this.n = n; } get twice() { return this.n * 2; } }
const __WEBPACK_DEFAULT_EXPORT__ = (function named(x) { return "d" + x; });
/***/ }),
/***/ "./b.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  g: () => (/* binding */ g)
});
function g(o, n) { return o.n + n; }
/***/ }),
/***/ "./utils.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
var a_ = __webpack_require__("./a.js");
var b_ = __webpack_require__("./b.js");
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ a_.f),
  C: () => (/* reexport safe */ a_.C),
  count: () => (/* reexport safe */ a_.count),
  dd: () => (/* reexport safe */ a_["default"]),
  g: () => (/* reexport safe */ b_.g),
  mine: () => (/* binding */ mine)
});
function mine(x) { return (0,a_.f)(x).length + (0,b_.g)({ n: x }, 1); }
/***/ }),
/***/ "./main.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  go: () => (/* binding */ go),
  u: () => (/* reexport module object */ u)
});
var a_ = __webpack_require__("./a.js");
var b_ = __webpack_require__("./b.js");
var u = __webpack_require__("./utils.js");
const used = [];
function use(plugin) { if (!~used.indexOf(plugin)) { plugin(used, u); used.push(plugin); } return used.length; }
function go(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += (0,a_.f)(i).length + new a_.C(i).twice + (0,b_.g)({ n: i }, 2);
  return s + a_.count + use((x, y) => { globalThis.shown = y; }) + globalThis.shown.f(1).length + globalThis.shown["count"] + Object.keys(globalThis.shown).join() + new globalThis.shown.C(3).twice;
}
/***/ })
});
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
var module = __webpack_module_cache__[moduleId] = {
exports: {}
};
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
return module.exports;
}
(() => {
__webpack_require__.d = (exports, definition) => {
for(var key in definition) {
if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
}
}
};
})();
(() => {
__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
})();
(() => {
__webpack_require__.r = (exports) => {
if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
}
Object.defineProperty(exports, '__esModule', { value: true });
};
})();
var __webpack_exports__ = {};
(() => {
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const m = __webpack_require__("./main.js");
console.log(m.go(3000), m.go(3), Object.keys(m).join(), attempt(() => m.u.mine(3)), attempt(() => m.u.nothing), JSON.stringify(Object.getOwnPropertyDescriptor(m.u, "f")));
})();
})();
