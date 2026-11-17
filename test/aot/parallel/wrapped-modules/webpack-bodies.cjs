// The bodies of webpack's runtime: cycles, throws, late stores, replaced exports, and what is read before it is set.
var out = [];
var show = f => { try { var v = f(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } };
(() => {
var __webpack_modules__ = ({
  "./point.js": ((module, exports, __webpack_require__) => {
    __webpack_require__.r(exports);
    __webpack_require__.d(exports, { Point: () => Point, count: () => count, "default": () => make });
    out.push("point sees " + show(() => count) + " " + show(() => Point));
    class Point {
      constructor(x = 0, y = 0) { this.x = x; this.y = y; count++; }
      add(o) { return new Point(this.x + o.x, this.y + o.y); }
    }
    let count = 0;
    function make(x) { return new Point(x, x); }
  }),
  "./early.js": ((module, exports, __webpack_require__) => {
    exports.first = 1;
    var other = __webpack_require__("./cycle.js");
    exports.second = other.seen;
    exports.third = () => other.later();
  }),
  "./cycle.js": ((module, exports, __webpack_require__) => {
    var early = __webpack_require__("./early.js");
    exports.seen = show(() => early.first) + " " + show(() => early.second);
    exports.later = () => early.second + "!";
  }),
  7: ((module) => { module.exports = function seven(x) { return x * 7; }; module.exports.own = [7]; }),
  "./thrower.js": ((module, exports) => { exports.before = "set"; if (out.length >= 0) throw new Error("thrown"); exports.after = "never"; }),
  "./json.js": ((module) => { module.exports = JSON.parse('{"a":[1,2],"__proto__":3}'); }),
  "./lazy.js": ((module, exports, __webpack_require__) => {
    exports.load = n => n ? __webpack_require__(7)(n) : __webpack_require__("./json.js").a;
    exports.names = () => Object.keys(__webpack_require__("./point.js")).sort().join();
    exports.tag = () => Object.prototype.toString.call(__webpack_require__("./point.js"));
  }),
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
    for (var key in definition) {
      if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
        Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
      }
    }
  };
})();
(() => { __webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop)); })();
(() => {
  __webpack_require__.r = (exports) => {
    if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    }
    Object.defineProperty(exports, '__esModule', { value: true });
  };
})();
var __webpack_exports__ = {};
(() => {
  var lazy = __webpack_require__("./lazy.js");
  out.push(String(lazy.load(6)), show(() => lazy.load(0)));
  var point = __webpack_require__("./point.js");
  var sum = new point.Point();
  for (var i = 0; i < 1000; i++) sum = sum.add(point["default"](i));
  out.push(sum.x + "," + sum.y + " of " + point.count, lazy.names(), lazy.tag());
  var early = __webpack_require__("./early.js");
  out.push(early.second, early.third(), show(() => __webpack_require__("./cycle.js").seen));
  for (var k = 0; k < 2; k++) { try { var t = __webpack_require__("./thrower.js"); out.push(show(() => t.before), show(() => t.after)); } catch (e) { out.push(e.message); } }
  var seven = __webpack_require__(7);
  out.push(String(seven(3)), show(() => seven.own), String(__webpack_require__("7") === seven));
  var json = __webpack_require__("./json.js");
  json.b = 4;
  out.push(show(() => __webpack_require__("./json.js")), show(() => point.absent));
  point.added = 1;
  out.push(show(() => __webpack_require__("./point.js").added));
})();
})();
for (const line of out) console.log(line);
