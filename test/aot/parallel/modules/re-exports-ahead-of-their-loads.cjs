// webpack writes the getters of re-exports ahead of the loads. Where nobody asks in between, they are the names behind them.
// COUNTER: SiteCacheEntriesAllocated <= 2
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
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ a_.f),
  C: () => (/* reexport safe */ a_.C),
  count: () => (/* reexport safe */ a_.count),
  dd: () => (/* reexport safe */ a_["default"]),
  g: () => (/* reexport safe */ b_.g),
  mine: () => (/* binding */ mine)
});
var a_ = __webpack_require__("./a.js");
var b_ = __webpack_require__("./b.js");
function mine(x) { return (0,a_.f)(x).length + (0,b_.g)({ n: x }, 1); }
/***/ }),
/***/ "./deep.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ u_.f),
  h: () => (/* reexport safe */ u_.g)
});
var u_ = __webpack_require__("./utils.js");

/***/ }),
/***/ "./main.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  go: () => (/* binding */ go)
});
var u = __webpack_require__("./utils.js");
var deep = __webpack_require__("./deep.js");
function go(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += u.f(i).length + new u.C(i).twice + (0,u.g)({ n: i }, 2) + u.mine(i) + deep.f(i).length + (0,deep.h)({ n: 1 }, i) + u.dd(i).length;
  return s + u.count;
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
console.log(m.go(3000), m.go(3));
})();
})();
