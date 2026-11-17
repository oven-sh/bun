// The bodies of webpack's runtime that read `this`, which the runtime passes as module.exports, and that store into the exports parameter.
// STATISTIC: ModulesWithValue >= 7
var out = [], show = v => typeof v === "object" && v ? Object.keys(v).join() : typeof v === "function" ? "function " + v.name : String(v);
(() => {
var __webpack_modules__ = ({
"./umd.js": (function (__unused_webpack_module, exports) {
(function (global, factory) { out.push(global === exports); factory(exports); })(this, (function (exports) { "use strict"; function Point(x, y) { this.x = x; this.y = y; } Point.prototype.sum = function () { return this.x + this.y; }; exports.Point = Point; Object.defineProperty(exports, "__esModule", { value: true }); }));
}),
"./root.js": (function () {
!function (root) { root.name = "root"; root.make = n => ({ sum: () => n + 1 }); }(this);
}),
"./stores.js": (function (module, exports, __webpack_require__) {
this.before = 1; out.push(show(exports), this === module.exports); (() => { this.arrow = 2; })(); delete this.before;
module.exports = { after: 3, old: this }; out.push(this === module.exports, show(this), __webpack_require__("./umd.js").Point.name);
}),
"./assigned.js": ((module, exports) => {
var first = exports; module.exports = exports = { wrap(v) { return [v]; }, first }; exports.added = 4; out.push(first === exports, module.exports === exports);
}),
"./reassigned.js": ((__unused_webpack_module, exports) => {
exports.seen = 1; exports = { hidden: 2 }; exports.more = 3; out.push(show(exports));
}),
"./cycle.js": (function (module, exports, __webpack_require__) {
this.early = 1; var other = __webpack_require__("./cycle2.js"); this.late = 2; out.push("cycle " + show(other));
}),
"./cycle2.js": (function (module, exports, __webpack_require__) {
var back = __webpack_require__("./cycle.js"); out.push("back " + show(back)); this.read = function () { return show(back); };
}),
"./main.js": ((__unused_webpack_module, exports, __webpack_require__) => {
"use strict";
var umd = __webpack_require__("./umd.js"), root = __webpack_require__("./root.js"), stores = __webpack_require__("./stores.js"), assigned = __webpack_require__("./assigned.js"), reassigned = __webpack_require__("./reassigned.js"), cycle = __webpack_require__("./cycle.js"), cycle2 = __webpack_require__("./cycle2.js");
exports.run = function (n) { var sum = 0; for (var i = 0; i < n; i++) sum += new umd.Point(i, 1).sum() + root.make(i).sum(); out.push(sum, show(umd), show(root), show(stores), show(stores.old), show(assigned), assigned.wrap(1).length, show(assigned.first), show(reassigned), show(cycle), cycle2.read(), root === __webpack_require__("./root.js")); };
})
});
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cachedModule = __webpack_module_cache__[moduleId];
  if (cachedModule !== undefined) { return cachedModule.exports; }
  var module = __webpack_module_cache__[moduleId] = { exports: {} };
  __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
  return module.exports;
}
__webpack_require__("./main.js").run(100);
})();
console.log(out.join("\n"));
