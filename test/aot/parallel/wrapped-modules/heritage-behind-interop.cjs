// Classes extend what a helper of module interop hands on: default exports of marked and of unmarked modules, names, through esbuild's, TypeScript's and Babel's helpers, at the top of the file and in a function.
// STATISTIC: AllocationsTypedByRunningConstructor >= 8
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var require_whole = __commonJS({ "whole.js"(exports, module) { class Whole { constructor(n) { this.n = n; this.list = []; } add(m) { this.n += m; return this; } get twice() { return this.n * 2; } static make(n) { return new this(n); } } module.exports = Whole; } });
var require_marked = __commonJS({ "marked.js"(exports) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.Named = exports.default = void 0; class Marked { constructor(n) { this.n = n; this.kind = "marked"; } add(m) { this.n -= m; return this; } } class Named extends Marked { constructor(n) { super(n); this.name = "named"; } } exports.default = Marked; exports.Named = Named; } });
var require_changed = __commonJS({ "changed.js"(exports) { Object.defineProperty(exports, "__esModule", { value: true }); exports.default = class Before { constructor() { this.before = 1; } who() { return "before"; } }; exports.change = () => { exports.default = class After { constructor() { this.after = 2; this.more = 3; } who() { return "after"; } }; }; } });
var require_tsc = __commonJS({ "tsc.js"(exports) { "use strict"; var __importDefault = exports && exports.__importDefault || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
Object.defineProperty(exports, "__esModule", { value: true });
const whole_1 = __importDefault(require_whole()), marked_1 = __importDefault(require_marked()), marked_2 = require_marked();
exports.A = class A extends whole_1.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + this.twice + this.list.length; } };
exports.B = class B extends marked_1.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + this.kind.length; } };
exports.C = class C extends marked_2.Named { constructor(n) { super(n); this.c = 1; } sum() { return this.n + this.c + this.name.length; } }; } });
var require_babel = __commonJS({ "babel.js"(exports) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.D = exports.E = void 0; var _whole = _interopRequireDefault(require_whole()); var _marked = _interopRequireDefault(require_marked()); function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
class D extends _whole.default { constructor(n) { super(n); this.d = 2; } sum() { return this.n * this.d; } } exports.D = D; class E extends _marked.default { constructor(n) { super(n); this.e = 3; } sum() { return this.n * this.e; } } exports.E = E; } });
var import_whole = __toESM(require_whole()), import_marked = __toESM(require_marked()), import_node_mode = __toESM(require_marked(), 1);
class F extends import_whole.default { constructor(n) { super(n); this.f = 4; } sum() { return this.n + this.f; } }
class G extends import_marked.default { constructor(n) { super(n); this.g = 5; } sum() { return this.n + this.g; } }
class H extends import_marked.Named { constructor(n) { super(n); this.h = 6; } sum() { return this.n + this.h; } }
class I extends import_node_mode.default.default { constructor(n) { super(n); this.i = 7; } sum() { return this.n + this.i; } }
const inFunction = (() => {
  var wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
  var require_base = wrap((exports, module) => { module.exports = class Base { constructor(n) { this.n = n; this.rest = null; } add(m) { this.n += m; return this; } }; });
  var require_names = wrap((exports) => { exports.Point = class Point { constructor(x, y) { this.x = x; this.y = y; } }; });
  var require_heirs = wrap((exports) => { var Base = require_base(), names_1 = require_names(); exports.J = class J extends Base { constructor(n) { super(n); this.j = 8; } sum() { return this.n + this.j; } }; exports.K = class K extends names_1.Point { constructor(n) { super(n, n); this.k = 9; } add() { return this; } sum() { return this.x + this.y + this.k; } }; });
  var Parent = require_base();
  class L extends Parent { constructor(n) { super(n); this.l = 10; } sum() { return this.n + this.l + (this.rest === null ? 1 : 0); } }
  return { ...require_heirs(), L };
})();
const { A, B, C } = require_tsc(), { D, E } = require_babel(), { J, K, L } = inFunction;
const classes = [A, B, C, D, E, F, G, H, I, J, K, L];
for (const Class of classes) { let total = 0; for (let i = 0; i < 60; i++) total += new Class(i, 2).add(1).sum(); out.push(Class.name + total, JSON.stringify(new Class(1, 2)), Object.keys(new Class(3)).join()); }
out.push(A.make(5).n, new A(1) instanceof require_whole(), new F(1) instanceof import_whole.default, new I(1) instanceof require_marked().default);
const changed = __toESM(require_changed());
class M extends changed.default { constructor() { super(); this.m = 1; } }
out.push(JSON.stringify(new M()), new M().who());
require_changed().change();
class N extends changed.default { constructor() { super(); this.n = 1; } }
out.push(JSON.stringify(new N()), new N().who(), JSON.stringify(new M()));
Object.setPrototypeOf(F, class Other { constructor() { this.other = 1; } }); Object.setPrototypeOf(F.prototype, { add() { return this; } });
out.push(JSON.stringify(new F(9)), show(() => new F(9).add().sum()));
out.push(show(() => typeof class extends __toESM(null).default {}), show(() => typeof class extends __toESM(require_whole()).missing {}), show(() => Reflect.construct(A, [1, 2], B).sum()));
for (const line of out) console.log(line);
