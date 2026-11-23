// A bundled module that passes on what others export, on a cycle or with its object shown: its getters stay what it defines first,
// so a read of them is a test of the variable that the getter reads, and then the variable behind it.
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
  who: () => (/* binding */ who)
});
let count = 0; function f(x) { count++; return "f" + x; }
class C { constructor(n) { this.n = n; } get twice() { return this.n * 2; } }
function who() { return typeof this; }
/***/ }),
/***/ "./cycle.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  seen: () => (/* binding */ seen),
  later: () => (/* binding */ later),
  late: () => (/* binding */ late)
});
var u = __webpack_require__("./utils.js");
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const seen = [() => u.f(1), () => u.count, () => new u.C(1), () => u.later, () => typeof u.mine, () => u.late].map(attempt).join();
function later(n) { let s = 0; for (let i = 0; i < n; i++) s += u.f(i).length + new u.C(i).twice + u.count; return s; }
let late = "late";
/***/ }),
/***/ "./inner.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ a_.f),
  C: () => (/* reexport safe */ a_.C),
  count: () => (/* reexport safe */ a_.count),
  who: () => (/* reexport safe */ a_.who)
});
var a_ = __webpack_require__("./a.js");
/***/ }),
/***/ "./utils.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ inner_.f),
  C: () => (/* reexport safe */ inner_.C),
  count: () => (/* reexport safe */ inner_.count),
  who: () => (/* reexport safe */ inner_.who),
  all: () => (/* reexport module object */ inner_),
  seen: () => (/* reexport safe */ cycle_.seen),
  later: () => (/* reexport safe */ cycle_.later),
  late: () => (/* reexport safe */ cycle_.late),
  mine: () => (/* binding */ mine)
});
var cycle_ = __webpack_require__("./cycle.js");
var inner_ = __webpack_require__("./inner.js");
function mine(x) { return "m" + x; }
/***/ }),
/***/ "./broken.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { z: () => (/* binding */ z), w: () => (/* binding */ w) });
let z = 1; function w() { return "w" + z; }
throw new Error("a load that fails");
/***/ }),
/***/ "./half.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  f: () => (/* reexport safe */ a_.f),
  z: () => (/* reexport safe */ broken_.z),
  w: () => (/* reexport safe */ broken_.w)
});
var a_ = __webpack_require__("./a.js");
var broken_ = __webpack_require__("./broken.js");
/***/ }),
/***/ "./tries.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { tried: () => (/* binding */ tried) });
let tried = "fine";
try { __webpack_require__("./half.js"); } catch (e) { tried = e.message; }
/***/ }),
/***/ "./main.js":
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { go: () => (/* binding */ go), broken: () => (/* binding */ broken), u: () => (/* reexport module object */ u) });
var u = __webpack_require__("./utils.js");
var tries_ = __webpack_require__("./tries.js");
var half_ = __webpack_require__("./half.js");
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
function go(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += (0,u.f)(i).length + new u.C(i).twice + u.count + u.mine(i).length + u.later(2);
  return s;
}
function broken() { return [tries_.tried, ...[() => half_.f(1), () => half_.z, () => half_.w()].map(attempt)].join(); }
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
const m = __webpack_require__("./main.js");
console.log(m.go(3000), m.go(3));
globalThis.shown = m.u;
console.log(m.go(3), shown.f(1), shown["count"], Object.keys(shown).join(), new shown.C(3).twice, shown.seen, shown.late);
console.log(shown.who(), JSON.stringify(Object.getOwnPropertyDescriptor(shown, "f")), Reflect.set(shown, "f", 1), Reflect.deleteProperty(shown, "f"), Reflect.defineProperty(shown, "f", { value: 1 }));
Object.setPrototypeOf(shown, { f: 1, inherited: 2 });
console.log(m.go(3), shown.inherited, m.broken());
})();
})();
