// A variable that holds a required module is destructured: the names are read from the module, at that time.
(function () {
  function start(modules, cache, entries) {
    function load(id, again) {
      if (!cache[id]) {
        if (!modules[id]) {
          var require_ = typeof require == "function" && require;
          if (!again && require_) return require_(id, true);
          throw new Error("no module " + id);
        }
        var module = (cache[id] = { exports: {} });
        modules[id][0].call(module.exports, function (name) { var found = modules[id][1][name]; return load(found || name); }, module, module.exports, start, modules, cache, entries);
      }
      return cache[id].exports;
    }
    for (var require_ = typeof require == "function" && require, i = 0; i < entries.length; i++) load(entries[i]);
    return load;
  }
  return start;
})()({
  1: [function (require, module, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.later = exports.utils = exports.Point = exports.count = void 0;
    class Point {
      constructor(x, y) { this.x = x; this.y = y; }
      add(other) { if (!(other instanceof Point)) throw new TypeError("a point, please"); return new Point(this.x + other.x, this.y + other.y); }
    }
    exports.Point = Point;
    exports.count = 1;
    exports.utils = { twice(v) { return exports.utils.scale * v; }, scale: 2, nested: { deep: [1, 2, 3] } };
    exports.bump = () => { exports.count = exports.count + 1; return exports.count; };
    let held;
    Object.defineProperties(exports.utils, { hook: { configurable: false, get() { return held; }, set(value) { if (!held) held = value; } } });
    Object.defineProperty(exports, "read", { enumerable: true, get: function () { return "by a getter"; } });
    exports.later = function () { return this === undefined ? "no receiver" : typeof this; };
  }, {}],
  2: [function (require, module, exports) {
    const first = require("./lib");
    let second = require("./lib");
    const { Point, count, missing = "a default", ["count"]: sameCount } = first;
    console.log(new Point(1, 2).add(new Point(3, 4)), count, missing, sameCount);
    const { utils: { twice, nested: { deep: [, middle, ...others] } }, later } = second;
    console.log(twice.call(null, 21), middle, others, typeof later, second.later());
    second.bump();
    const { count: after } = second;
    console.log(count, after, first.count);
    const run = async (n) => {
      const { Point: Inner, bump, read } = second;
      let p = new Inner(0, 0);
      for (let i = 0; i < n; i++) { const { Point, utils } = second; p = p.add(new Point(i, utils.scale)); }
      return [p, bump(), read];
    };
    run(5).then((shown) => console.log(shown));
    second.utils.hook = (a) => a + "!";
    const { utils } = second;
    console.log(utils.hook("held"), Object.keys(utils).join());
    for (const { Point: P, count: c } = first; ; ) { console.log(P === Point, c); break; }
    try { early(); } catch (error) { console.log(error.name, error.message); }
    function early() { const { bump } = third; return bump; }
    const third = require("./lib");
    console.log(typeof early());
    try { hoisted(); } catch (error) { console.log(error.name, error.message); }
    function hoisted() { const { count } = fourth; return count; }
    var fourth = require("./lib");
    console.log(hoisted());
    const cycle = require("./cycle");
    const { both, ...rest } = cycle;
    console.log(both, rest);
    console.log(require("./whole").all());
  }, { "./lib": 1, "./cycle": 3, "./whole": 5 }],
  3: [function (require, module, exports) {
    exports.early = "early";
    const other = require("./other");
    const { seen } = other;
    exports.both = [exports.early, seen];
    exports.third = 3;
  }, { "./other": 4 }],
  4: [function (require, module, exports) {
    const back = require("./cycle");
    const { early, both = "not yet" } = back;
    exports.seen = [early, both];
  }, { "./cycle": 3 }],
  5: [function (require, module, exports) {
    const whole = require("./replaced");
    const { one, two } = whole;
    exports.all = () => { const { one: again } = whole; return [one, two, again, typeof whole, Object.keys(whole)]; };
  }, { "./replaced": 6 }],
  6: [function (require, module, exports) {
    module.exports = { one: 1, get two() { return "two of the literal"; } };
  }, {}],
}, {}, [2]);
