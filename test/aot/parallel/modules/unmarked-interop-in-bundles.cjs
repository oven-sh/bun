// `_lib.default` behind Babel's interop helper is what require() answered, where the module has no marker. The same helper written
// in line by a minifier.
// COUNTER: SiteCacheEntriesAllocated <= 1
(() => {
var __webpack_modules__ = ({
/***/ "./assert.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = assertString;
function assertString(x) { if (typeof x !== "string") throw new TypeError("no string: " + x); return x.length; }
module.exports = exports.default;
module.exports.default = exports.default;
/***/ }),
/***/ "./digits.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true }), exports.default = function (x) { return (0, i.default)(x) + x.charCodeAt(0) % 10; };
var t, i = (t = __webpack_require__("./assert.js")) && t.__esModule ? t : { default: t };
module.exports = exports.default, module.exports.default = exports.default;
/***/ }),
/***/ "./point.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
module.exports = class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } };
/***/ }),
/***/ "./marked.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = function twice(x) { return x * 2; };
exports.swap = function () { exports.default = function thrice(x) { return x * 3; }; };
/***/ }),
/***/ "./numbers.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
module.exports = { add(a, b) { return a + b; }, scale: 2 };
/***/ }),
/***/ "./nothing.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
module.exports = null;
/***/ }),
/***/ "./flagged.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
module.exports = function flagged(x) { return x + 1; };
module.exports.__esModule = true;
module.exports.default = function inner(x) { return x + 100; };
/***/ }),
/***/ "./cycle.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
var use = __webpack_require__("./during.js");
module.exports = function late(x) { return x + 7; };
module.exports.seen = use.seen;
module.exports.later = use.later;
/***/ }),
/***/ "./during.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
var t, half = (t = __webpack_require__("./cycle.js")) && t.__esModule ? t : { default: t };
exports.seen = typeof half.default;
exports.later = function () { return typeof half.default; };
/***/ }),
/***/ "./broken.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
if (globalThis.process.argv.length) throw new Error("a load that fails");
module.exports = function never() { return 1; };
/***/ }),
/***/ "./main.js":
/***/ ((module, exports, __webpack_require__) => {
"use strict";
function early() { try { return (0, _digits.default)("1"); } catch (e) { return e.constructor.name; } }
const before = early();
var _digits = _interopRequireDefault(__webpack_require__("./digits.js"));
var _assert = _interopRequireDefault(__webpack_require__("./assert.js"));
var _point = _interopRequireDefault(__webpack_require__("./point.js"));
var _marked = _interopRequireDefault(__webpack_require__("./marked.js"));
var _numbers = _interopRequireDefault(__webpack_require__("./numbers.js"));
var _nothing = _interopRequireDefault(__webpack_require__("./nothing.js"));
var _flagged = _interopRequireDefault(__webpack_require__("./flagged.js"));
let tried = "fine";
try { __webpack_require__("./broken.js"); } catch (e) { tried = e.message; }
var _broken = _interopRequireDefault(__webpack_require__("./broken.js"));
var s, _inline = (s = __webpack_require__("./broken.js")) && s.__esModule ? s : { default: s };
var _late = _interopRequireDefault(__webpack_require__("./cycle.js"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
exports.go = function (n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += (0, _digits.default)("" + i) + (0, _assert.default)("a") + new _point.default(i, 1).sum();
  return s;
};
exports.rest = function () {
  const all = [before, early(), typeof _digits.default, (0, _marked.default)(4), _numbers.default.add(1, _numbers.default.scale), _nothing.default, (0, _flagged.default)(1), (0, _late.default)(1), _late.default.seen, _late.default.later(), tried, typeof _broken.default, _inline.default === _broken.default, Object.keys(_inline.default).length];
  __webpack_require__("./marked.js").swap();
  return all.join() + (0, _marked.default)(4) + _digits["default"].name + _point.default.name;
};
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
console.log(m.rest());
})();
})();
