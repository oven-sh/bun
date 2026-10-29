// A member of an object is a function that the object's maker writes. The compiler may put off making the function until the member is first read.
// What a program can find out must not depend on when that is. Every way of making such an object meets every way of looking at it, each pair with names of its own, so that no pair changes how another is compiled.
import { programsOf } from "../generate";

/** `make#(x)` gives an object with the members a#, f# and, behind them, z#. `f#()` gives what `x` was, unless the maker's name says otherwise. */
const makers: Record<string, string> = {
  "a-literal-with-an-arrow-over-nothing": "function make#(x) { return { a#: x, f#: () => 7, z#: 1 }; }",
  "a-literal-with-an-arrow-over-a-parameter": "function make#(x) { return { a#: x, f#: () => x, z#: 1 }; }",
  "a-literal-with-two-arrows-over-a-variable": "function make#(x) { let kept = x; return { a#: x, f#: () => kept, s#: value => { kept = value; }, z#: 1 }; }",
  "a-literal-with-a-function-that-reads-this": "function make#(x) { return { a#: x, f#: function () { return this.a#; }, z#: 1 }; }",
  "a-literal-with-a-method": "function make#(x) { return { a#: x, f#() { return this.a#; }, z#: 1 }; }",
  "a-literal-with-a-method-that-reads-super": "const above# = { b#() { return this.a#; } };\nfunction make#(x) { const made = { a#: x, f#() { return super.b#(); }, z#: 1 }; Object.setPrototypeOf(made, above#); return made; }",
  "a-literal-with-a-function-that-names-itself": "function make#(x) { return { a#: x, f#: function self(again) { return again ? self : x; }, z#: 1 }; }",
  "a-literal-with-an-async-arrow": "function make#(x) { return { a#: x, f#: async () => x, z#: 1 }; }",
  "a-literal-with-a-generator": "function make#(x) { return { a#: x, f#: function* () { yield x; }, z#: 1 }; }",
  "a-literal-filled-by-stores": "function make#(x) { const made = {}; made.a# = x; made.f# = () => x; made.z# = 1; return made; }",
  "a-literal-filled-by-stores-with-an-arrow-over-the-object": "function make#(x) { const made = { a#: x }; made.f# = () => made.a#; made.z# = 1; return made; }",
  "a-literal-filled-by-stores-between-calls": "function make#(x) { const made = { a#: x }; count(); made.f# = () => made.a#; made.z# = count(); return made; }",
  "a-class-with-an-arrow-in-a-field": "class C# { a#; f# = () => this.a#; z# = 1; constructor(x) { this.a# = x; } }\nfunction make#(x) { return new C#(x); }",
  "a-class-with-an-arrow-over-nothing-in-a-field": "class C# { a#; f# = () => 7; z# = 1; constructor(x) { this.a# = x; } }\nfunction make#(x) { return new C#(x); }",
  "a-class-whose-constructor-stores-an-arrow": "class C# { constructor(x) { this.a# = x; this.f# = () => this.a#; this.z# = 1; } }\nfunction make#(x) { return new C#(x); }",
  "a-class-whose-constructor-stores-an-arrow-over-its-parameter": "class C# { constructor(x) { this.a# = x; this.f# = () => x; this.z# = 1; } }\nfunction make#(x) { return new C#(x); }",
  "a-class-whose-constructor-calls-a-method-that-stores": "class C# { constructor(x) { this.a# = x; this.fill#(); this.z# = 1; } fill#() { this.f# = () => this.a#; } }\nfunction make#(x) { return new C#(x); }",
  "a-class-whose-constructor-calls-two-levels-of-methods": "class C# { constructor(x) { this.first#(x); this.z# = 1; } first#(x) { this.a# = x; this.second#(); } second#() { this.f# = () => this.a#; } }\nfunction make#(x) { return new C#(x); }",
  "a-function-called-with-new": "function C#(x) { this.a# = x; this.f# = function () { return x; }; this.z# = 1; }\nfunction make#(x) { return new C#(x); }",
  "a-function-called-with-new-and-an-arrow-over-this": "function C#(x) { this.a# = x; this.f# = () => this.a#; this.z# = 1; }\nfunction make#(x) { return new C#(x); }",
  "a-class-below-a-class-with-the-field": "class B# { a#; f# = () => this.a#; constructor(x) { this.a# = x; } }\nclass C# extends B# { z# = 1; }\nfunction make#(x) { return new C#(x); }",
  "a-class-that-gives-the-field-of-the-class-above-anew": "class B# { a#; f# = () => -1; constructor(x) { this.a# = x; } }\nclass C# extends B# { f# = () => this.a#; z# = 1; }\nfunction make#(x) { return new C#(x); }",
  "two-classes-below-one-with-the-field": "class B# { a#; f# = () => this.a#; constructor(x) { this.a# = x; } }\nclass C# extends B# { z# = 1; }\nclass D# extends B# { z# = 1; y# = 2; }\nfunction make#(x) { return x % 2 ? new C#(x) : new D#(x); }",
  "two-literals-of-one-shape-with-different-functions": "function make#(x) { return x % 2 ? { a#: x, f#: () => x, z#: 1 } : { a#: x, f#: () => x + 0, z#: 1 }; }",
  "a-literal-whose-member-is-sometimes-null": "function make#(x) { return x > 100 ? { a#: x, f#: null, z#: 1 } : { a#: x, f#: () => x, z#: 1 }; }",
  "a-literal-made-in-a-loop": "function make#(x) { let last; for (let i = 0; i <= x; i++) last = { a#: i, f#: () => i, z#: 1 }; return last; }",
  "a-literal-in-a-literal": "function make#(x) { return { inner#: { a#: x, f#: () => x, z#: 1 } }.inner#; }",
};

/** `o` and `p` are `make#(5)` and `make#(6)`. `key` hands its argument on, and the compiler cannot tell. */
const looks: Record<string, string> = {
  "calls-it": "show(o.f#())",
  "calls-it-twice-and-compares": "o.f# === o.f# && o.f# !== p.f#",
  "its-name-and-length": "o.f#.name + o.f#.length + typeof o.f#",
  "its-text": "String(o.f#).length > 5",
  "its-prototype-property": "typeof o.f#.prototype + Object.getOwnPropertyNames(o.f#).sort()",
  "a-tag-on-it-stays": "(o.f#.tag = 3, o.f#.tag + String(p.f#.tag))",
  "keys": "Object.keys(o) + '|' + Object.getOwnPropertyNames(o) + '|' + Reflect.ownKeys(o).length",
  "values": "Object.values(o).map(each => typeof each) + '|' + (Object.values(o)[1] === o.f#)",
  "values-then-a-call": "show(Object.values(o).find(each => typeof each === 'function').call(o))",
  "entries": "Object.entries(o).map(([name, each]) => name + typeof each).join()",
  "from-entries": "show(Object.fromEntries(Object.entries(o)).f#())",
  "a-descriptor": "JSON.stringify(Object.getOwnPropertyDescriptor(o, 'f#')) + typeof Object.getOwnPropertyDescriptor(o, 'f#').value",
  "descriptors": "Object.entries(Object.getOwnPropertyDescriptors(o)).map(([name, each]) => name + typeof each.value + each.writable).join()",
  "json": "JSON.stringify(o) + JSON.stringify(o, (name, each) => (typeof each === 'function' ? 'function' : each))",
  "a-spread": "show({ ...o }.f#()) + ({ ...o }.f# === o.f#) + Object.keys({ ...o })",
  "a-spread-before-any-read": "(c => show(c.f#.call(c)) + (c.f# === o.f#))({ ...o, a#: 9 })",
  "assign-to-an-empty-object": "(c => show(c.f#()) + (c.f# === o.f#))(Object.assign({}, o))",
  "assign-to-the-other": "(Object.assign(p, o), p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "a-loop-over-names-to-the-other": "(() => { for (const name in o) p[name] = o[name]; p.a# = 8; return show(p.f#()) + (p.f# === o.f#); })()",
  "a-store-of-the-others": "(p.f# = o.f#, p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "a-store-by-key-of-the-others": "(p[key('f#')] = o.f#, p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "reflect-set-of-the-others": "(Reflect.set(p, 'f#', o.f#), p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "a-definition-of-the-others": "(Object.defineProperty(p, 'f#', { value: o.f# }), p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "a-swap": "(() => { const kept = o.f#; o.f# = p.f#; p.f# = kept; return show(o.f#()) + show(p.f#()); })()",
  "a-pattern": "(({ f# }) => show(f#.call(o)))(o)",
  "a-pattern-with-a-rest": "(({ a#, ...rest }) => show(rest.f#.call(o)) + Object.keys(rest) + (rest.f# === o.f#))(o)",
  "reflect-get": "show(Reflect.get(o, 'f#').call(o))",
  "a-read-by-key": "show(o[key('f#')]())",
  "a-read-by-key-first-then-by-name": "o[key('f#')] === o.f#",
  "a-number-stored-by-key": "(o[key('f#')] = 3, o.f# + '|' + Object.keys(o) + show(p.f#()))",
  "a-string-stored-by-key": "(o[key('f#')] = 'text', o.f# + '|' + Object.keys(o) + show(p.f#()))",
  "a-number-stored-by-name": "(o.f# = 3.5, o.f# + '|' + Object.keys(o) + show(p.f#()))",
  "undefined-stored": "(o.f# = undefined, String(o.f#) + ('f#' in o) + Object.keys(o) + show(p.f#()))",
  "an-object-stored": "(o.f# = { n: 1 }, JSON.stringify(o) + show(p.f#()))",
  "another-function-stored": "(o.f# = () => 'other', o.f#() + show(p.f#()))",
  "deleted": "(delete o.f#) + String(o.f#) + ('f#' in o) + Object.keys(o) + show(p.f#())",
  "deleted-by-key": "(delete o[key('f#')]) + String(o.f#) + ('f#' in o) + Object.keys(o) + show(p.f#())",
  "deleted-and-stored-again": "(delete o.f#, o.f# = () => 'again', o.f#() + Object.keys(o))",
  "the-member-before-it-deleted": "(delete o.a#, typeof o.f# + Object.keys(o) + (o.f# === o.f#))",
  "in-and-has-own": "('f#' in o) + '' + Object.hasOwn(o, 'f#') + o.hasOwnProperty(key('f#')) + o.propertyIsEnumerable('f#')",
  "frozen": "(Object.freeze(o), Object.isFrozen(o) + show(o.f#()) + (o.f# === o.f#))",
  "frozen-then-stored": "(Object.freeze(o), attempt(() => { 'use strict'; o.f# = 1; }) + show(o.f#()))",
  "sealed": "(Object.seal(o), Object.isSealed(o) + show(o.f#()) + Object.isFrozen(o))",
  "no-more-members": "(Object.preventExtensions(o), Object.isExtensible(o) + show(o.f#()))",
  "made-a-getter": "(Object.defineProperty(o, 'f#', { get() { return () => 'got'; } }), o.f#() + Object.keys(o) + show(p.f#()))",
  "made-hidden": "(Object.defineProperty(o, 'f#', { enumerable: false }), Object.keys(o) + show(o.f#()))",
  "made-read-only": "(Object.defineProperty(o, 'f#', { writable: false }), attempt(() => { 'use strict'; o.f# = 1; }) + show(o.f#()))",
  "an-heir": "show(Object.create(o).f#())",
  "an-heir-with-a-member-of-its-own": "(h => (h.a# = 9, show(h.f#()) + (h.f# === o.f#)))(Object.create(o))",
  "another-prototype": "(Object.setPrototypeOf(o, { more: 1 }), show(o.f#()) + o.more)",
  "a-proxy": "show(new Proxy(o, {}).f#())",
  "a-proxy-that-lists": "Object.entries(new Proxy(o, {})).map(([name, each]) => name + typeof each).join()",
  "inspected": "Bun.inspect(o).replace(/\\s+/g, ' ')",
  "inspected-by-node": "require('util').inspect(o).replace(/\\s+/g, ' ')",
  "cloned": "attempt(() => structuredClone(o))",
  "compared-deeply": "Bun.deepEquals(o, o) + '' + Bun.deepEquals(o, p) + Bun.deepEquals({ ...o }, o)",
  "a-weak-map": "(w => (w.set(o.f#, 1), w.has(o.f#) + '' + w.has(p.f#)))(new WeakMap())",
  "another-receiver": "show(o.f#.call(p)) + show(o.f#.apply({ a#: 'x' })) + show(o.f#.bind(p)())",
  "taken-off-the-object": "(f => show(attempt(() => f())))(o.f#)",
  "collected-in-between": "(Bun.gc(true), show(o.f#()) + (Bun.gc(true), show(p.f#())))",
  "collected-with-the-maker-gone": "(list => (Bun.gc(true), list.map(each => show(each.f#())).join()))(Array.from({ length: 40 }, (_, i) => make#(i)))",
  "constructed": "attempt(() => typeof new o.f#())",
  "optional-and-tests": "show(o.f#?.()) + !o.f# + (o.f# ?? 1 ? 'y' : 'n') + (o.f# instanceof Function) + (o.f# == null)",
  "through-a-global": "(globalThis.held# = o, show(globalThis.held#.f#()) + (globalThis.held#.f# === o.f#))",
  "through-text": "show(new Function('given', 'return given.f#()')(o))",
  "stored-by-text": "(new Function('given', 'from', 'given.f# = from.f#')(p, o), p.a# = 8, show(p.f#()) + (p.f# === o.f#))",
  "a-number-stored-by-text": "(new Function('given', 'given.f# = 4')(o), o.f# + '|' + Object.keys(o) + show(p.f#()))",
  "the-member-it-reads-changes-first": "(o.a# = 'late', show(o.f#()))",
  "in-an-array-and-sorted": "[p, o].sort((l, r) => l.a# - r.a#).map(each => show(each.f#())).join()",
  "a-member-added-behind": "(o.more# = 1, show(o.f#()) + Object.keys(o))",
  "many-members-added-behind": "(() => { for (let i = 0; i < 70; i++) o['m' + i] = i; return show(o.f#()) + Object.keys(o).length; })()",
  "held-across-an-await": "await (async () => { await null; return show(o.f#()); })()",
  "an-index-added": "(o[0] = 'zero', show(o.f#()) + Object.keys(o))",
  "given-to-a-map-as-a-callback": "[1].map(o.f#).map(show).join()",
  "a-class-below-it": "attempt(() => typeof class extends o.f# {})",
  "to-a-primitive": "attempt(() => `${o.f#}`.length > 3)",
};

const head = `let counted = 0;
function count() { return ++counted; }
function key(name) { return process.argv.length > 100 ? "none" : name; }
function attempt(f) { try { return f(); } catch (error) { return error?.constructor?.name; } }
function show(value) {
  if (typeof value === "function") return "function";
  if (value && typeof value.then === "function") return "promise";
  if (value && typeof value.next === "function") return "yields " + value.next().value;
  return String(value);
}
`;

/** A function over one parameter holds the value itself, and is made with its object. */
const madeWithTheirObjects = new Set(["a-literal-with-an-arrow-over-a-parameter", "a-literal-with-a-function-that-names-itself", "a-literal-with-an-async-arrow", "a-literal-with-a-generator", "a-literal-filled-by-stores", "a-class-whose-constructor-stores-an-arrow-over-its-parameter", "a-function-called-with-new", "two-literals-of-one-shape-with-different-functions", "a-literal-whose-member-is-sometimes-null", "a-literal-made-in-a-loop", "a-literal-in-a-literal"]);

const everyLook = () => {
  const written: Record<string, string> = {};
  for (const maker in makers) {
    let text = `// ${maker.replaceAll("-", " ")}, looked at in every way.\n${madeWithTheirObjects.has(maker) ? "" : "// STATISTIC: FieldsDeferringClosures >= 100\n"}${head}`;
    let n = 0;
    for (const look in looks) {
      n++;
      const named = (part: string) => part.replaceAll("#", String(n));
      text += `${named(makers[maker])}\nasync function look${n}() { const o = make${n}(5), p = make${n}(6); return ${named(looks[look])}; }\ntry { console.log("${look}", await look${n}()); } catch (error) { console.log("${look}", "throws", error?.constructor?.name); }\n`;
    }
    written[`a-function-in-${maker}.js`] = text;
  }
  return written;
};

const headOfMakers = `let counted = 0, fail = 0;
function count() { if (++counted === fail) throw new RangeError("stop"); return counted; }
function key(name) { return process.argv.length > 100 ? "none" : name; }
function attempt(f) { try { return f(); } catch (error) { return error?.constructor?.name; } }
function list(o) { return o === undefined ? "nothing" : Object.keys(o).map(name => name + ":" + typeof o[name]).join(); }
function failAt(n) { counted = 0; fail = n; }
`;
/** Makers that are left half way, entered again, or entered by another road. What stands behind SHOW is printed. */
const makersLeftHalfWay: Record<string, string> = {
  "a-literal-filled-in-a-try": `function make#(x) { let made; try { made = { a#: x }; made.b# = count(); made.f# = () => made.a#; made.c# = count(); made.g# = () => made.b#; } catch { return list(made); } return list(made) + made.f#() + made.g#(); }
   SHOW [0, 1, 2].map(n => (failAt(n), make#(5))).join(" ")`,
  "a-const-literal-filled-in-a-try-with-finally": `function make#(x, out) { const made = { a#: x }; try { made.b# = count(); made.f# = () => made.a#; made.c# = count(); } finally { out.push(list(made)); } return made; }
   SHOW [0, 1, 2].map(n => { failAt(n); const out = []; attempt(() => make#(5, out)); return out.join(); }).join(" ")`,
  "a-constructor-left-half-way-seen-by-the-caller": `let seen#; class C# { constructor(x) { seen# = this; this.a# = x; this.b# = count(); this.f# = () => this.a#; } }
   SHOW [0, 1].map(n => (failAt(n), attempt(() => new C#(5).f#()) + list(seen#))).join(" ")`,
  "a-constructor-with-a-try-of-its-own": `class C# { constructor(x) { try { this.a# = x; this.b# = count(); this.f# = () => this.a#; this.c# = count(); this.g# = () => this.b#; } catch { this.failed# = list(this); } } }
   SHOW [0, 1, 2].map(n => (failAt(n), list(new C#(5)) + "/" + new C#(6).failed#)).join(" ")`,
  "fields-of-a-class-left-half-way": `let out# = []; class B# { constructor() { out#.push(this); } } class C# extends B# { a# = 1; b# = count(); f# = () => this.a#; c# = count(); g# = () => this.b#; }
   SHOW [0, 1, 2].map(n => (failAt(n), attempt(() => list(new C#())) + "/" + list(out#.at(-1)))).join(" ")`,
  "fields-of-a-class-without-a-parent-left-half-way": `class C# { a# = 1; b# = count(); f# = () => this.a#; c# = count(); g# = () => this.b#; }
   SHOW [0, 1, 2].map(n => (failAt(n), attempt(() => list(new C#())))).join(" ")`,
  "a-method-that-fills-is-called-again": `class C# { constructor(x) { this.a# = x; this.fill#(); } fill#() { this.f# = () => this.a#; this.n# = count(); } }
   SHOW (o => { const first = o.f#; o.f# = () => "other"; o.fill#(); return o.f#() + (o.f# === first) + o.n#; })((failAt(0), new C#(5)))`,
  "a-method-that-fills-is-called-on-another-object": `class C# { constructor(x) { this.a# = x; this.fill#(); } fill#() { this.f# = () => this.a#; } }
   SHOW (other => (C#.prototype.fill#.call(other), new C#(5).f#() + other.f#() + list(other)))({ a#: "other" })`,
  "a-method-that-fills-is-found-by-key": `class C# { constructor(x) { this.a# = x; this.fill#(); } fill#() { this.f# = () => this.a#; } }
   SHOW (o => { const first = o.f#; o[key("fill#")](); return o.f#() + (o.f# === first); })(new C#(5))`,
  "a-method-that-fills-is-replaced-below": `class C# { constructor(x) { this.a# = x; this.fill#(); } fill#() { this.f# = () => this.a#; } } class D# extends C# { fill#() { this.f# = () => "below"; } }
   SHOW new C#(5).f#() + new D#(6).f#() + list(new D#(7))`,
  "a-method-that-fills-is-replaced-on-the-prototype": `class C# { constructor(x) { this.a# = x; this.fill#(); } fill#() { this.f# = () => this.a#; } }
   SHOW (before => (C#.prototype[key("fill#")] = function () { this.f# = () => "replaced"; }, before + new C#(6).f#()))(new C#(5).f#())`,
  "the-member-is-sometimes-left-out": `function make#(x) { const made = { a#: x }; if (x > 5) made.f# = () => made.a#; return made; }
   SHOW [5, 6].map(x => (o => list(o) + typeof o.f# + ("f#" in o) + attempt(() => o.f#()))(make#(x))).join(" ")`,
  "the-member-comes-after-the-object-is-seen": `const all# = []; function make#(x) { const made = { a#: x }; all#.push(made); const early = list(all#.at(-1)) + typeof all#.at(-1).f#; made.f# = () => made.a#; return early + list(made) + made.f#(); }
   SHOW make#(5) + make#(6)`,
  "the-member-is-stored-twice": `function make#(x) { const made = { a#: x }; made.f# = () => 1; made.z# = 2; made.f# = () => made.a#; return made; }
   SHOW list(make#(5)) + make#(5).f#()`,
  "the-member-is-stored-then-deleted-then-stored": `function make#(x) { const made = { a#: x }; made.f# = () => 1; made.z# = 2; delete made.f#; made.f# = () => made.a#; return made; }
   SHOW list(make#(5)) + make#(5).f#()`,
  "a-setter-above-takes-the-store": `const taken# = []; class B# { set f#(value) { taken#.push(typeof value); } } class C# extends B# { constructor(x) { super(); this.a# = x; this.f# = () => this.a#; } }
   SHOW list(new C#(5)) + taken# + typeof new C#(5).f#`,
  "a-setter-comes-above-later": `class C# { constructor(x) { this.a# = x; this.f# = () => this.a#; } }
   SHOW (before => (Object.defineProperty(C#.prototype, key("f#"), { set(value) { this.got# = typeof value; }, configurable: true }), before + list(new C#(6))))(list(new C#(5)))`,
  "the-constructor-gives-back-another-object": `class B# { constructor(given) { return given; } } class C# extends B# { f# = () => this.a#; }
   SHOW (given => (new C#(given), list(given) + given.f#()))({ a#: "given" }) + (o => { const first = o.f#; new C#(o); return o.f# === first; })(new C#({ a#: 1 }))`,
  "another-new-target": `class C# { constructor(x) { this.a# = x; this.f# = () => this.a#; } } class Other# { get f#() { return () => "other"; } more#() { return "more"; } }
   SHOW (o => list(o) + o.f#() + o.more#() + (o instanceof Other#))(Reflect.construct(C#, [5], Other#))`,
  "the-arrow-is-made-before-a-branch": `function make#(x) { const made = { a#: x }; const f = () => made.a#; if (x > 5) made.f# = f; else made.g# = 1; return made; }
   SHOW list(make#(5)) + list(make#(6)) + make#(6).f#()`,
  "the-arrow-goes-to-two-members": `function make#(x) { const made = { a#: x }; const f = () => made.a#; made.f# = f; made.g# = f; return made; }
   SHOW (o => o.f# === o.g#)(make#(5))`,
  "the-arrow-goes-to-two-objects": `function make#(x) { const f = () => x; return [{ f#: f }, { f#: f }]; }
   SHOW (([l, r]) => l.f# === r.f#)(make#(5))`,
  "one-arrow-for-every-turn": `function make#(x) { const made = []; const f = () => x; for (let i = 0; i < 3; i++) made.push({ f#: f }); return made; }
   SHOW (l => l[0].f# === l[2].f#)(make#(5))`,
  "an-arrow-over-another-object-of-the-class": `class C# { constructor(x, other) { this.a# = x; this.f# = other ? () => other.a# : () => this.a#; } }
   SHOW (o => new C#(6, o).f#() + "" + o.f#())(new C#(5))`,
  "an-arrow-over-this-stored-in-another-object-of-the-class": `class C# { constructor(x, other) { this.a# = x; this.f# = () => this.a#; if (other) other.f# = () => this.a#; } }
   SHOW (o => (new C#(6, o), o.f#()))(new C#(5))`,
  "a-method-stores-an-arrow-over-this-in-its-argument": `class C# { constructor(x) { this.a# = x; this.f# = () => this.a#; } lend#(other) { other.f# = () => this.a#; } }
   SHOW ((o, p) => (o.lend#(p), p.f#() + "" + o.f#()))(new C#(5), new C#(6))`,
  "two-names-for-one-object": `function make#(x) { const made = { a#: x }; const same = made; same.f# = () => made.a#; return made; }
   SHOW make#(5).f#()`,
  "the-variable-gets-another-object-later": `function make#(x) { let made = { a#: x }; const first = made; made.f# = () => made.a#; made = { a#: "later" }; return first; }
   SHOW make#(5).f#()`,
  "the-object-is-copied-raw-by-a-class-of-the-same-fields": `class C# { constructor(x) { this.a# = x; this.f# = () => this.a#; } copy#() { const made = new C#(0); Object.assign(made, this); made.a# = "copy"; return made; } }
   SHOW new C#(5).copy#().f#()`,
  "the-object-is-spread-into-the-same-shape": `function make#(x) { const made = { a#: x, f#: null }; made.f# = () => made.a#; return made; }
   SHOW (o => (c => (c.a# = "copy", c.f#()))({ ...o }))(make#(5))`,
  "a-literal-of-the-same-shape-takes-the-member": `function make#(x) { const made = { a#: x, f#: null }; made.f# = () => made.a#; return made; }
   SHOW (o => ({ a#: "copy", f#: o.f# }).f#())(make#(5))`,
  "the-fields-are-read-while-the-class-is-made": `class C# { a# = 1; f# = () => this.a#; k# = Object.keys(this).join(); t# = typeof this.f#; g# = () => this.k#; }
   SHOW (o => o.k# + o.t# + o.g#() + list(o))(new C#())`,
  "a-field-calls-the-field-before-it": `class C# { a# = 1; f# = () => this.a#; r# = this.f#(); s# = this.f# === this.f#; }
   SHOW (o => o.r# + "" + o.s#)(new C#())`,
  "a-generator-fills-the-object": `function* make#(x) { const made = { a#: x }; made.b# = yield made; made.f# = () => made.a#; yield made; }
   SHOW (g => { const o = g.next().value; const early = list(o); g.next(2); return early + " " + list(o) + o.f#(); })(make#(5))`,
  "an-async-function-fills-the-object": `let held#; async function make#(x) { const made = { a#: x }; held# = made; made.b# = await x; made.f# = () => made.a#; return made; }
   SHOW await (async () => { const p = make#(5); const early = list(held#); const o = await p; return early + " " + list(o) + o.f#(); })()`,
  "many-members": `function make#(x) { const made = { a#: x }; ${Array.from({ length: 40 }, (_, i) => `made.f#_${i} = () => made.a# + ${i};`).join(" ")} return made; }
   SHOW (o => Object.keys(o).length + "" + o.f#_0() + o.f#_39() + Object.values(o).filter(each => typeof each === "function").length)(make#(5))`,
  "an-object-in-an-object-with-arrows": `function make#(x) { const made = { a#: x, inner#: { b#: x + 1, f#: () => x } }; made.g# = () => made.inner#; return made; }
   SHOW (o => o.g#().f#() + list(o.inner#) + (o.g#() === o.inner#) + JSON.stringify(o))(make#(5))`,
  "an-inner-object-with-an-arrow-over-itself": `class I# { constructor(x) { this.b# = x; this.f# = () => this.b#; } } class C# { constructor(x) { this.inner# = new I#(x); this.a# = x; } }
   SHOW (o => { const i = o.inner#; return i.f#() + "" + o.inner#.f#() + (i.f# === o.inner#.f#) + list(i); })(new C#(5))`,
  "an-inner-object-outlives-its-holder": `class I# { constructor(x) { this.b# = x; this.f# = () => this.b#; } } class C# { constructor(x) { this.inner# = new I#(x); this.a# = x; } }
   SHOW (l => (Bun.gc(true), l.map(i => i.f#()).join()))(Array.from({ length: 20 }, (_, i) => new C#(i).inner#))`,
};
const everyMakerLeftHalfWay = () => {
  const written: Record<string, string> = {};
  let n = 0, all = headOfMakers;
  for (const name in makersLeftHalfWay) {
    n++;
    const [declarations, shown] = makersLeftHalfWay[name].replaceAll("#", String(n)).split(/\n\s*SHOW /);
    const text = `${declarations}\ntry { console.log("${name}", ${shown}); } catch (error) { console.log("${name}", "throws", error?.constructor?.name); }\n`;
    written[`a-function-in-a-member-${name}.js`] = `// ${name.replaceAll("-", " ")}\n${headOfMakers}${text}`;
    all += text;
  }
  written["functions-in-members-makers-left-half-way-all-together.js"] = `// Makers that are left half way, entered again, or entered by another road, in one program.\n// STATISTIC: FieldsDeferringClosures >= 40\n${all}`;
  return written;
};

export const programs = () => programsOf({ ...everyLook(), ...everyMakerLeftHalfWay() });
