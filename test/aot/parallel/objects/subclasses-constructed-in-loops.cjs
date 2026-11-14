// What functions that loops reach construct finishes its birth in line, a subclass too, whatever a constructor lets others do to the object.
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
globalThis.watch = null;
class Node { constructor(defaults) { this.raws = {}; for (const name in defaults) this[name] = defaults[name]; if (globalThis.watch) globalThis.watch(this); } text() { return this.type + ":" + Object.keys(this).join() + Object.keys(this.raws).length; } }
class Declaration extends Node { constructor(defaults) { super(defaults); this.type = "decl"; this.important = false; } }
class Container extends Node { constructor(defaults) { super(defaults); this.nodes = []; this.type = "container"; } push(node) { node.parent = this; this.nodes.push(node); } size() { let n = 0; for (let i = 0; i < this.nodes.length; i++) n += this.nodes[i].type.length; return n + this.type.length; } }
class Rule extends Container { constructor(defaults) { super(defaults); this.type = "rule"; this.selectors = this.nodes.length; } }
class Parser {
  constructor(text) { this.text = text; this.pos = 0; this.root = new Container({}); this.current = this.root; }
  parse() { while (this.pos < this.text.length) { const c = this.text.charCodeAt(this.pos++); if (c === 123) this.rule(); else if (c === 125) this.current = this.current.parent || this.root; else this.other(c); } return this.root; }
  other(c) { for (let i = 0; i < 2; i++) this.declaration({ prop: String.fromCharCode(c + i), value: i }); }
  declaration(defaults) { this.current.push(new Declaration(defaults)); }
  rule() { const rule = new Rule({ selector: "a" }); this.current.push(rule); this.current = rule; }
}
function walk(node, depth) { let s = depth + node.text() + (node.nodes ? node.size() : "") + "\n"; if (node.nodes) for (const child of node.nodes) s += walk(child, depth + 1); return s; }
for (const text of ["ab{cd{e}f}g", "", "{{{x", "}}a"]) out.push(show(() => walk(new Parser(text).parse(), 0)));
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`({
  nothing(n) {}, deleted(n) { del§ete n.raws; }, again(n) { del§ete n.raws; n.raws = { again: 1 }; }, early(n) { n.type = "early"; }, gone(n) { n.type = "early"; del§ete n.type; }, frozen(n) { Ob§ject.freeze(n); }, sealed(n) { Ob§ject.seal(n); }, closed(n) { Ob§ject.preventExtensions(n); },
  locked(n) { Ob§ject.defineProperty(n, "type", { value: "locked", configurable: true }); }, accessor(n) { let held = "a"; Ob§ject.defineProperty(n, "raws", { get() { return { held }; }, set(v) { held = v; }, configurable: true, enumerable: true }); },
  above(n) { Ob§ject.setPrototypeOf(n, Ob§ject.assign(Ob§ject.create(Ob§ject.getPrototypeOf(n)), { important: 7 })); }, missing(n) { n.raws = undefined; n.nodes = null; }, extra(n) { n.extra = 1; n[0] = 2; }, thrown(n) { throw new RangeError("thrown"); },
})`.split("§").join(globalThis.nothing ?? ""));
for (const [name, fate] of Object.entries(fates)) {
  let count = 0;
  globalThis.watch = (node) => { if (++count % 3 === 2) fate(node); };
  out.push(name, show(() => walk(new Parser("a{bc{d}}e").parse(), 0)));
  for (const make of [() => new Declaration({ a: 1 }), () => new Rule({ b: 2 }), () => new Container({ nodes: 5 }), () => Reflect.construct(Declaration, [{}], Rule), () => new (class extends Rule { constructor() { super({}); delete this.type; } })()]) { const line = []; for (let i = 0; i < 3; i++) line.push(show(() => { const node = make(); return node.text() + (node.size ? show(() => node.size()) : "") + node.important + node.type; })); out.push(line.join(" ")); }
  globalThis.watch = null;
}
for (const line of out) console.log(line);
