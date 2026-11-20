// A read of a name off a module that is not loaded yet throws the error that quotes the member.
(() => {
var __webpack_modules__ = ({
/***/ "./a.js":
/***/ ((module, __webpack_exports__, __webpack_require__) => {
"use strict";
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { f: () => (f), C: () => (C), n: () => (n) });
function f(x) { return x; }
class C {}
let n = 1;
/***/ }),
/***/ "./early.js":
/***/ ((module, __webpack_exports__, __webpack_require__) => {
"use strict";
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { seen: () => (seen) });
var main_ = __webpack_require__("./main.js");
const seen = main_.go();
/***/ }),
/***/ "./barrel.js":
/***/ ((module, __webpack_exports__, __webpack_require__) => {
"use strict";
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { f: () => (a_.f), n: () => (a_.n), seen: () => (early_.seen) });
var early_ = __webpack_require__("./early.js");
var a_ = __webpack_require__("./a.js");
/***/ }),
/***/ "./main.js":
/***/ ((module, __webpack_exports__, __webpack_require__) => {
"use strict";
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { go: () => (go) });
var barrel_ = __webpack_require__("./barrel.js");
var a_ = __webpack_require__("./a.js");
function go() { return [f => a_.n, () => a_.f(1), () => (0, a_.f)(2), () => new a_.C().constructor.name, () => barrel_.f(3), () => barrel_.n, () => typeof a_.f, () => a_.n + a_.n].map(f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } }).join("\n"); }
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
const main = __webpack_require__("./main.js");
const barrel = __webpack_require__("./barrel.js");
globalThis.shown = barrel;
console.log(barrel.seen);
console.log(main.go());
})();
})();
