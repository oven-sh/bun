// Classes of a bundle's modules extend classes that other modules of the bundle export: whole, under a name, by a getter, late, conditionally, not at all.
// STATISTIC: AllocationsTypedByRunningConstructor >= 4
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
(() => {
var __webpack_modules__ = ({
  "./node.js": ((module, exports, __webpack_require__) => {
    class Node {
      constructor(defaults = {}) { this.raws = {}; this.line = 0; for (let name in defaults) this[name] = defaults[name]; }
      get proxyOf() { return this; }
      at(line) { this.line = line; return this; }
      toString() { return this.type + "@" + this.line + (this.raws.before || ""); }
      static from(text) { return new this({ text }); }
    }
    module.exports = Node;
    Node.default = Node;
  }),
  "./declaration.js": ((module, exports, __webpack_require__) => {
    let Node = __webpack_require__("./node.js");
    class Declaration extends Node { constructor(defaults) { if (defaults && typeof defaults.value === "number") defaults = { ...defaults, value: String(defaults.value) }; super(defaults); this.type = "decl"; } get variable() { return this.prop.startsWith("--"); } }
    module.exports = Declaration;
    Declaration.default = Declaration;
  }),
  "./container.js": ((module, exports, __webpack_require__) => {
    let Declaration = __webpack_require__("./declaration.js"), Node = __webpack_require__("./node.js");
    let Rule;
    class Container extends Node {
      get first() { return this.proxyOf.nodes[0]; }
      push(child) { child.parent = this; this.proxyOf.nodes.push(child); return this; }
      each(callback) { let iterator = this.getIterator(), index, result; while (this.indexes[iterator] < this.proxyOf.nodes.length) { index = this.indexes[iterator]; result = callback(this.proxyOf.nodes[index], index); if (result === false) break; this.indexes[iterator] += 1; } delete this.indexes[iterator]; return result; }
      getIterator() { if (!this.lastEach) this.lastEach = 0; if (!this.indexes) this.indexes = {}; this.lastEach += 1; this.indexes[this.lastEach] = 0; return this.lastEach; }
      walk(visit) { return this.each((child, i) => { let result = visit(child, i); if (result !== false && child.walk) result = child.walk(visit); return result; }); }
      rule(selector) { return this.push(new Rule({ selector })); }
      decl(prop, value) { return this.push(new Declaration({ prop, value })); }
    }
    Container.registerRule = (dependant) => { Rule = dependant; };
    module.exports = Container;
  }),
  "./rule.js": ((module, exports, __webpack_require__) => {
    let Container = __webpack_require__("./container.js");
    class Rule extends Container { constructor(defaults) { super(defaults); this.type = "rule"; if (!this.nodes) this.nodes = []; } get selectors() { return this.selector.split(","); } set selectors(values) { this.selector = values.join(", "); } }
    module.exports = Rule;
    Rule.default = Rule;
    Container.registerRule(Rule);
  }),
  "./named.js": ((module, exports) => { exports.Base = class Base { constructor(n) { this.n = n; this.tags = []; } tag(t) { this.tags.push(t); return this; } }; module.exports.Other = class { constructor() { this.other = 1; } }; exports.make = () => class { constructor() { this.made = 1; } }; }),
  "./heirs.js": ((module, exports, __webpack_require__) => {
    const named = __webpack_require__("./named.js"), { Other } = __webpack_require__("./named.js");
    exports.A = class A extends named.Base { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + this.tags.length; } };
    exports.B = class B extends Other { constructor() { super(); this.own = 2; } sum() { return this.other + this.own; } };
    exports.C = class C extends (__webpack_require__("./named.js").make()) { constructor() { super(); this.own = 3; } sum() { return this.made + this.own; } };
    exports.D = class D extends exports.A { constructor(n) { super(n, 10); } };
  }),
  "./esm.js": ((module, __webpack_exports__, __webpack_require__) => {
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, { "default": () => (Shape), Sized: () => (Sized) });
    class Shape { constructor(x) { this.x = x; } area() { return this.x * this.x; } }
    class Sized extends Shape { constructor(x, y) { super(x); this.y = y; } area() { return this.x * this.y; } }
  }),
  "./esm-heir.js": ((module, __webpack_exports__, __webpack_require__) => {
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, { Box: () => (Box), Square: () => Square });
    var _esm__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__("./esm.js");
    class Box extends _esm__WEBPACK_IMPORTED_MODULE_0__.Sized { constructor(x, y, z) { super(x, y); this.z = z; } volume() { return this.area() * this.z; } }
    class Square extends _esm__WEBPACK_IMPORTED_MODULE_0__["default"] { constructor(x) { super(x); this.name = "square"; } }
  }),
  "./replaced.js": ((module, exports) => { module.exports = class First { constructor() { this.first = 1; } who() { return "first" + this.first; } }; if (out.length > 1e6) module.exports = class Never {}; exports.ignored = 1; }),
  "./replaced-late.js": ((module, exports) => { class Old { constructor() { this.a = 1; } who() { return "old" + this.a; } } module.exports = Old; module.exports = class New { constructor() { this.b = 2; } who() { return "new" + this.b; } }; }),
  "./either.js": ((module) => { if (out.length >= 0) module.exports = class Yes { constructor() { this.yes = 1; } who() { return "yes" + this.yes; } }; else module.exports = class No { constructor() { this.no = 0; } who() { return "no" + this.no; } }; }),
  "./either-heir.js": ((module, exports, __webpack_require__) => {
    const First = __webpack_require__("./replaced.js"), New = __webpack_require__("./replaced-late.js"), Yes = __webpack_require__("./either.js");
    for (const Parent of [First, New, Yes]) { class Heir extends Parent { constructor() { super(); this.c = 3; } who() { return super.who() + this.c; } } out.push(new Heir().who()); }
    exports.heirs = [class extends First { constructor() { super(); this.c = 4; } }, class extends New { constructor() { super(); this.c = 5; } }, class extends Yes { constructor() { super(); this.c = 6; } }];
  }),
  "./ring-a.js": ((module, exports, __webpack_require__) => { exports.early = show(() => __webpack_require__("./ring-b.js").B.name); class A { constructor() { this.a = 1; } } exports.A = A; exports.late = () => new (__webpack_require__("./ring-b.js").B)(); }),
  "./ring-b.js": ((module, exports, __webpack_require__) => { const a = __webpack_require__("./ring-a.js"); exports.failed = show(() => class extends a.A {}); exports.B = class B { constructor() { class Inner extends a.A { constructor() { super(); this.b = 2; } } this.inner = new Inner(); } }; }),
  "./self.js": ((module, exports, __webpack_require__) => { module.exports = __webpack_require__("./self-2.js"); }),
  "./self-2.js": ((module, exports, __webpack_require__) => { module.exports = __webpack_require__("./self.js"); exports.X = class X {}; }),
  "./main.js": ((module, exports, __webpack_require__) => {
    const Rule = __webpack_require__("./rule.js"), Declaration = __webpack_require__("./declaration.js"), Node = __webpack_require__("./node.js"), { A, B, C, D } = __webpack_require__("./heirs.js"), { Box, Square } = __webpack_require__("./esm-heir.js");
    const root = new Rule({ selector: "root" });
    for (let i = 0; i < 30; i++) { root.rule("r" + i + ", x"); for (let j = 0; j < 4; j++) root.nodes[i].decl(j ? "p" + j : "--v", i * j); }
    let text = 0;
    root.walk((child, i) => { text += String(child.at(i)).length + (child.variable ? 1 : 0) + (child.selectors ? child.selectors.length : child.value.length); });
    out.push(text, root.first instanceof Node, String(Declaration.from("t")), Object.keys(root.nodes[3].nodes[2]).join(), Object.keys(new Declaration({ value: 5, prop: "q", type: "x" })).join(), new Declaration({ value: 5 }).value);
    root.nodes[2].selectors = ["a", "b"]; root.nodes[2].raws = { before: "!" }; out.push(root.nodes[2].selector, String(root.nodes[2]));
    let total = 0;
    for (let i = 0; i < 50; i++) total += new A(i, 1).tag(i).sum() + new B().sum() + new C().sum() + new D(i).sum() + new Box(i, 2, 3).volume() + new Square(i).area();
    out.push(total, JSON.stringify([new A(1, 2), new B(), new C(), new D(3), new Box(1, 2, 3), new Square(4)]));
    for (const Heir of __webpack_require__("./either-heir.js").heirs) out.push(JSON.stringify(new Heir()), show(() => new Heir().who()));
    const ring = __webpack_require__("./ring-a.js"); out.push(ring.early, __webpack_require__("./ring-b.js").failed, JSON.stringify(ring.late()));
    out.push(show(() => class extends __webpack_require__("./self.js") {}), show(() => new (class extends __webpack_require__("./self-2.js").X { })().constructor.name));
    class Later extends Declaration { } Object.setPrototypeOf(Later, Rule); Object.setPrototypeOf(Later.prototype, Rule.prototype); out.push(new Later({ selector: "z" }).type, new Later({ selector: "y" }).selectors.join());
    Object.setPrototypeOf(Declaration, class Swapped { constructor() { this.swapped = 1; this.raws = []; } }); out.push(JSON.stringify(new Declaration({ value: 1 })), show(() => new Declaration().at(3)));
    out.push(show(() => Reflect.construct(Rule, [{ a: 1 }], Declaration).type), show(() => Rule.prototype.walk.call({ each() { return "borrowed"; } })), show(() => Node.prototype.at.call(null, 1)));
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
    if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    }
    Object.defineProperty(exports, "__esModule", { value: true });
  };
})();
var __webpack_exports__ = __webpack_require__("./main.js");
})();
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_base = __commonJS((exports, module) => { module.exports = class Base { constructor(v) { this.v = v; } get() { return this.v; } }; });
var require_heir = __commonJS((exports) => { var Base = require_base(); exports.Heir = class Heir extends Base { constructor(v) { super(v); this.w = v + 1; } both() { return this.get() * this.w; } }; });
var { Heir } = require_heir();
let products = 0;
for (let i = 0; i < 40; i++) products += new Heir(i).both();
out.push(products);
for (const line of out) console.log(line);
