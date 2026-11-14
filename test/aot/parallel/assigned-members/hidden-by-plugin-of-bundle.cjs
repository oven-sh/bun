// A plugin's class hides a method that a statement laid on the prototype of a constructor function. The other methods still answer for its instances.
(() => {
var __webpack_modules__ = ({
"./parser.js": ((__unused_webpack_module, exports, __webpack_require__) => {
"use strict";
__webpack_require__.d(exports, { Parser: () => Parser });
function Place(line, column) { this.line = line; this.column = column; }
var Parser = function Parser(input) { this.input = input; this.pos = 0; this.type = 0; this.start = 0; this.end = 0; this.place = null; };
var pp = Parser.prototype;
Parser.extend = function extend() { var plugins = [], len = arguments.length; while (len--) plugins[len] = arguments[len]; var cls = this; for (var i = 0; i < plugins.length; i++) cls = plugins[i](cls); return cls; };
pp.current = function () { return new Place(1, this.pos); };
pp.read = function () { return this.input.charCodeAt(this.pos); };
pp.finish = function (type) { this.end = this.pos; this.type = type; return this.end - this.start; };
pp.next = function () { this.start = this.pos; this.place = this.current(); var c = this.read(); ++this.pos; return this.finish(c); };
pp.parse = function () { var n = 0; while (this.pos < this.input.length) n += this.next() + this.place.column; return n; };
}),
"./plugin.js": ((__unused_webpack_module, exports, __webpack_require__) => {
"use strict";
__webpack_require__.d(exports, { default: () => __WEBPACK_DEFAULT_EXPORT__ });
const STATE = Symbol("state");
const __WEBPACK_DEFAULT_EXPORT__ = () => P => class Heir extends P { constructor(input) { super(input); this[STATE] = { count: 0 }; } finish(type) { this[STATE].count++; return super.finish(type) + 1; } parse() { return super.parse() + this[STATE].count; } };
}),
"./main.js": ((__unused_webpack_module, exports, __webpack_require__) => {
"use strict";
__webpack_require__.d(exports, { run: () => run });
var _parser = __webpack_require__("./parser.js"), _plugin = __webpack_require__("./plugin.js");
function run(n) { const Heir = _parser.Parser.extend((0, _plugin["default"])()); let sum = 0; for (let i = 0; i < n; i++) sum += new Heir("some text to be parsed here").parse(); const plain = new _parser.Parser("some text"); return [sum, plain.parse(), new Heir("ab").finish(3), plain.finish(4)].join(); }
})
});
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cachedModule = __webpack_module_cache__[moduleId];
  if (cachedModule !== undefined) { return cachedModule.exports; }
  var module = __webpack_module_cache__[moduleId] = { exports: {} };
  __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
  return module.exports;
}
(() => { __webpack_require__.d = (exports, definition) => { for (var key in definition) { if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) { Object.defineProperty(exports, key, { enumerable: true, get: definition[key] }); } } }; })();
(() => { __webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop)); })();
console.log(__webpack_require__("./main.js").run(300));
})();
