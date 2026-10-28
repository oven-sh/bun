// One file of CommonJS and ES modules as a bundler writes it: every module behind a function that runs it at the first call.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) =>
  function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res;
  };
var __commonJS = (cb, mod) =>
  function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};

var log = [];

var require_numbers = __commonJS({
  "numbers.js"(exports) {
    log.push("numbers");
    exports.one = 1;
    exports.double = n => n * 2;
  },
});

var require_texts = __commonJS({
  "texts.js"(exports, module) {
    log.push("texts");
    var numbers = require_numbers();
    module.exports = { shout: text => text.toUpperCase() + "!".repeat(numbers.double(numbers.one)) };
  },
});

var require_cycle_a = __commonJS({
  "cycle-a.js"(exports) {
    log.push("cycle-a");
    exports.early = "a";
    var b = require_cycle_b();
    exports.late = b.seen + "+a";
  },
});

var require_cycle_b = __commonJS({
  "cycle-b.js"(exports) {
    log.push("cycle-b");
    var a = require_cycle_a();
    exports.seen = `${a.early},${a.late}`;
  },
});

var require_throws = __commonJS({
  "throws.js"(exports) {
    log.push("throws");
    exports.before = true;
    throw new Error("does not load");
  },
});

var shapes_exports = {};
__export(shapes_exports, { area: () => area, sides: () => sides });
var area, sides;
var init_shapes = __esm({
  "shapes.js"() {
    log.push("shapes");
    area = (w, h) => w * h;
    sides = 4;
  },
});

console.log(require_texts().shout("hey"), require_texts() === require_texts(), require_numbers().one);
console.log(require_cycle_a().late, require_cycle_b().seen);
try {
  require_throws();
} catch (error) {
  console.log(error.message, require_throws().before);
}
console.log(typeof area, init_shapes(), init_shapes(), shapes_exports.area(2, 3), shapes_exports.sides, Object.keys(shapes_exports).join());
console.log(log.join());
console.log(require_numbers.name, require_texts.name, init_shapes.name, require_numbers.length, require_numbers === require_texts);
