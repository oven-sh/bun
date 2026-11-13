// Bodies of webpack's runtime that do with their module's object what they want: the decorator of `module`, factories that take it, tests of it, its exports replaced late.
// STATISTIC: ModulesWithValue >= 8
var out = [], kept = {}, show = v => typeof v === "object" && v ? Object.keys(v).join() : typeof v === "function" ? "function " + v.name : String(v);
(() => {
var __webpack_modules__ = ({
"./factory.js": (function (module, __unused_webpack_exports, __webpack_require__) {
module = __webpack_require__.nmd(module);
(function (global, factory) { out.push(global === module.exports); if (true) { factory(module); module.exports = def(module); } function def(m) { return "default" in m.exports ? m.exports.default : m.exports; } })(this, (function (module) {
"use strict";
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
module.exports = { default: { Point, make: n => new Point(n, 1) } };
}));
}),
"./isBuffer.js": ((module, exports, __webpack_require__) => {
module = __webpack_require__.nmd(module);
var freeExports = true && exports && !exports.nodeType && exports;
var freeModule = freeExports && "object" == "object" && module && !module.nodeType && module;
var moduleExports = freeModule && freeModule.exports === freeExports;
out.push(moduleExports, Object.keys(module).join());
module.exports = moduleExports ? function isBuffer(value) { return !!value; } : undefined;
}),
"./late.js": ((module, exports) => {
exports.first = 1; kept.module = module; kept.replace = () => { module.exports = { second: 2 }; };
}),
"./getter.js": ((module) => {
var reads = 0; Object.defineProperty(module, "exports", { get() { return { reads: ++reads }; }, configurable: true });
}),
"./throws.js": ((module, exports) => {
kept.thrown = module; exports.part = 1; if (!kept.again) { kept.again = true; throw new RangeError("first"); } exports.whole = 2;
}),
"./cycle.js": (function (module, exports, __webpack_require__) {
exports.early = 1; var self = module; self.exports = { replaced: true }; var other = __webpack_require__("./cycle2.js"); out.push("cycle " + show(other), self.loaded); self.exports.late = 2;
}),
"./cycle2.js": ((module, exports, __webpack_require__) => {
var back = __webpack_require__("./cycle.js"); out.push("back " + show(back)); exports.read = () => show(back) + " " + show(__webpack_require__("./cycle.js"));
}),
"./harmony.js": ((module, __webpack_exports__, __webpack_require__) => {
"use strict";
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, { value: () => value, "default": () => read });
module = __webpack_require__.hmd(module);
let value = 1; function read() { return ++value; }
try { module.exports = {}; } catch (error) { out.push(error.message); }
}),
"./nothing.js": ((module) => { out.push(module.id, module.loaded); module = null; }),
"./main.js": ((__unused_webpack_module, exports, __webpack_require__) => {
"use strict";
var factory = __webpack_require__("./factory.js"), isBuffer = __webpack_require__("./isBuffer.js"), harmony = __webpack_require__("./harmony.js");
exports.run = function () { let sum = 0; for (let i = 0; i < 100; i++) sum += factory.make(i).sum() + new factory.Point(i, 2).sum() + (isBuffer(i) ? 1 : 0) + harmony["default"]() + harmony.value; return sum; };
}),
});
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== undefined) {
        return cachedModule.exports;
    }
    var module = __webpack_module_cache__[moduleId] = {
        id: moduleId,
        loaded: false,
        exports: {}
    };
    __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
    module.loaded = true;
    return module.exports;
}
(() => { __webpack_require__.d = (exports, definition) => { for (var key in definition) { if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) { Object.defineProperty(exports, key, { enumerable: true, get: definition[key] }); } } }; })();
(() => { __webpack_require__.hmd = (module) => { module = Object.create(module); if (!module.children) module.children = []; Object.defineProperty(module, "exports", { enumerable: true, set: () => { throw new Error("ES Modules may not assign module.exports: " + module.id); } }); return module; }; })();
(() => { __webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop)); })();
(() => { __webpack_require__.r = (exports) => { if (typeof Symbol !== "undefined" && Symbol.toStringTag) { Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" }); } Object.defineProperty(exports, "__esModule", { value: true }); }; })();
(() => { __webpack_require__.nmd = (module) => { module.paths = []; if (!module.children) module.children = []; return module; }; })();
(() => {
out.push(__webpack_require__("./main.js").run());
var late = __webpack_require__("./late.js"); kept.replace(); out.push(show(late), show(__webpack_require__("./late.js")), kept.module.id, kept.module.loaded);
out.push(__webpack_require__("./getter.js").reads < __webpack_require__("./getter.js").reads);
try { __webpack_require__("./throws.js"); } catch (error) { out.push(error.message, kept.thrown.loaded); }
out.push(show(__webpack_require__("./throws.js")));
__webpack_require__("./cycle.js"); out.push(__webpack_require__("./cycle2.js").read());
out.push(show(__webpack_require__("./nothing.js")));
})();
})();
console.log(out.join("\n"));
