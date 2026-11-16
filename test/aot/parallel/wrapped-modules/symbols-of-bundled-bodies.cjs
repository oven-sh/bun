// The body of a bundle's module makes symbols: the modules beside it use them as keys of their classes' fields, of records and of accessors. A symbol made in a loop, in a function or twice is no such key.
// STATISTIC: FlowAppendedFields >= 6
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
var __webpack_exports__ = {};
(() => {
var __webpack_modules__ = ({
  "./symbols.js": ((module) => {
    module.exports.isClean = Symbol("isClean");
    module.exports.my = Symbol("my");
    module.exports.same = Symbol.for("same");
  }),
  "./keys.js": ((module) => { module.exports = { kState: Symbol("state"), kNext: Symbol(), kText: "text" }; }),
  "./many.js": ((module, exports) => { const made = []; for (let i = 0; i < 3; i++) made.push(Symbol("many")); exports.made = made; exports.make = () => Symbol("made"); exports.late = undefined; exports.set = () => { exports.late = Symbol("late"); }; }),
  "./node.js": ((module, exports, __webpack_require__) => {
    let { isClean, my, same } = __webpack_require__("./symbols.js");
    class Node {
      constructor(defaults = {}) { this.raws = {}; this[isClean] = false; this[my] = true; for (let name in defaults) this[name] = defaults[name]; }
      get proxyOf() { return this; }
      markDirty() { if (this[isClean]) { this[isClean] = false; let next = this; while ((next = next.parent)) next[isClean] = false; } }
      walk(visit) { this[isClean] = true; let n = visit(this); for (const child of this.nodes || []) if (!child[isClean]) n += child.walk(visit); return n; }
      append(child) { (this.nodes ||= []).push(child); child.parent = this; child[same] = this.nodes.length; this.markDirty(); return this; }
    }
    module.exports = Node;
    Node.default = Node;
  }),
  "./state.js": ((module, exports, __webpack_require__) => {
    const { kState, kNext, kText } = __webpack_require__("./keys.js");
    exports.State = class State { [kState] = 1; constructor(next) { this[kNext] = next; this[kText] = "t"; } get [Symbol.toStringTag]() { return "State"; } step() { return this[kState]++ + (this[kNext] ? this[kNext].step() : 0); } static [kState]() { return "static"; } };
    exports.record = (n) => ({ [kState]: n, kState: -n, [kNext]: null });
    exports.keys = [kState, kNext, kText];
  }),
  "./main.js": ((module, exports, __webpack_require__) => {
    const Node = __webpack_require__("./node.js"), { isClean, my, same } = __webpack_require__("./symbols.js"), { State, record, keys } = __webpack_require__("./state.js"), many = __webpack_require__("./many.js");
    const root = new Node({ type: "root" });
    for (let i = 0; i < 20; i++) { const rule = new Node({ type: "rule", i }); for (let j = 0; j < 5; j++) rule.append(new Node({ type: "decl", prop: "p" + j, [isClean]: 5 })); root.append(rule); }
    out.push(root.walk((node) => node.type.length), root.walk((node) => node.type.length), root[isClean], root[my], root.nodes[3].nodes[2][same]);
    root.nodes[7].nodes[1].markDirty();
    out.push(root[isClean], root.walk(() => 1), Object.getOwnPropertySymbols(root.nodes[0]).map(String).join(), JSON.stringify(root.nodes[1].nodes[0], (key, value) => key === "parent" ? undefined : value));
    class Other extends Node { constructor(text) { super({ text }); this[isClean] = "other"; } get [my]() { return "mine"; } set [my](value) { out.push("set " + value); } }
    out.push(show(() => new Other("x")[isClean]), show(() => new Other("y")[my]), show(() => Object.keys(new Other("z")).join()));
    const plain = { [isClean]: 1, isClean: 2 }, proxy = new Proxy(root, { get(target, key) { out.push(String(key)); return target[key]; } }), frozen = Object.freeze(new Node({ type: "f" })), bare = Object.create(null);
    for (const o of [plain, proxy, frozen, bare, Object.create(root), [1], "text", 5, () => 1]) out.push(show(() => o[isClean]), show(() => Node.prototype.markDirty.call(o)), show(() => { o[isClean] = 9; return o[isClean]; }), show(() => delete o[isClean]), show(() => isClean in Object(o)));
    out.push(show(() => null[isClean]), show(() => { undefined[my] = 1; }), isClean.description, my.toString(), same === Symbol.for("same"), isClean === __webpack_require__("./symbols.js").isClean);
    Object.defineProperty(Node.prototype, isClean, { get() { return "above"; }, set(value) { out.push("laid " + value); }, configurable: true });
    out.push(show(() => new Node()[isClean]), root.nodes[0][isClean]);
    delete Node.prototype[isClean];
    let state = null;
    for (let i = 0; i < 4; i++) state = new State(state);
    out.push(state.step(), state.step(), State[keys[0]](), String(state), Reflect.ownKeys(state).map(String).join(), Reflect.ownKeys(record(3)).map(String).join(), record(4)[keys[0]] + record(5).kState);
    for (const key of keys) out.push(String(state[key] === undefined), show(() => Reflect.deleteProperty(state, key)), typeof state[key]);
    const bag = {};
    many.made.forEach((key, at) => { bag[key] = at; });
    out.push(Object.getOwnPropertySymbols(bag).length, many.make() === many.make(), many.made[0] === many.made[1], bag[many.made[2]]);
    const { late } = many;
    out.push(show(() => bag[late]), show(() => { bag[many.late] = 1; return bag.undefined; }));
    many.set();
    out.push(show(() => { bag[many.late] = 2; return bag[many.late]; }), Object.getOwnPropertySymbols(bag).length);
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
var __webpack_exports__ = __webpack_require__("./main.js");
})();
for (const line of out) console.log(line);
