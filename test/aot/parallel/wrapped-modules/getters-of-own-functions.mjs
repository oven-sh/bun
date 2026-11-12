// The output of swc, bundled as an ES module: getters on exports, each of a function that its own body declares and names nowhere else.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
const out = [];
const attempt = (name, g) => { try { out.push(name + " " + g()); } catch (error) { out.push(name + " " + error.constructor.name); } };
var require_a = __commonJS({ "src/a.js"(exports, module) {
  function _export(target, all) {
    for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });
  }
  _export(exports, {
    arrow: function () { return arrow; },
    expression: function () { return expression; },
    declared: function () { return declared; },
    Class: function () { return Class; },
    later: function () { return later; },
    default: function () { return _default; },
    bound: function () { return bound; }
  });
  attempt("arrow in front of its declaration", () => exports.arrow(1));
  attempt("declared in front of its declaration", () => exports.declared(1));
  attempt("b in a", () => require_b().twice(2));
  const base = 10;
  const arrow = x => x + base;
  const expression = function named(x) { return x < 1 ? 0 : 1 + named(x - 1); };
  function declared(x) { return x + 1; }
  class Class { value() { return 5; } }
  let later = x => x * 2;
  const _default = async x => x;
  const bound = (function (x) { return this.k + x; }).bind({ k: 3 });
} });
var require_b = __commonJS({ "src/b.js"(exports, module) {
  Object.defineProperty(exports, "twice", { enumerable: true, get: function () { return twice; } });
  Object.defineProperty(exports, "again", { enumerable: true, get: () => again });
  const twice = x => x * 2;
  attempt("a in b", () => require_a().arrow(2));
  let again = function () { return again.length; };
} });
attempt("a", () => Object.keys(require_a()).join());
const a = require_a();
attempt("arrow", () => a.arrow(1) + a.arrow.name + a.arrow.length);
attempt("expression", () => a.expression(4) + a.expression.name);
attempt("declared", () => a.declared(1) + a.declared.name);
attempt("Class", () => new a.Class().value() + a.Class.name);
attempt("later", () => a.later(4) + a.later.name);
attempt("default", () => typeof a.default + a.default.name);
attempt("bound", () => a.bound(4));
attempt("same", () => a.arrow === require_a().arrow);
attempt("b", () => require_b().twice(21) + require_b().again() + require_b().again.name);
let sum = 0;
for (let i = 0; i < 20; i++)
  sum += a.arrow(i) + require_b().twice(i);
attempt("sum", () => sum);
console.log(out.join("\n"));
export {};
