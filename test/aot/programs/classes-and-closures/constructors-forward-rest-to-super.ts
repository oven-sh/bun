// @ts-nocheck
const lines = [];
const show = value => JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function " + v.name : v instanceof Map ? ["Map", ...v] : v instanceof Error ? ["Error", v.message] : v));
function attempt(name, run) { let said; try { said = show(run()); } catch (e) { said = "THROWS " + e.constructor.name + (/^(the parent is n|extends null)/.test(name) ? "" : ": " + e.message); } lines.push(name + " | " + said); }
const noted = [];
function Plain(a, b, c) { this.got = [a, b, c, arguments.length]; this.target = new.target && new.target.name; }
Plain.prototype.kind = "plain";
class Base { constructor(a, b, c) { this.got = [a, b, c, arguments.length]; this.target = new.target.name; } }
class BaseWithRest { constructor(...all) { this.got = all; this.target = new.target.name; } }
class BaseWithDefaults { constructor(a = "da", b = "db") { this.got = [a, b, arguments.length]; } }
function Returning(a) { return { returned: a, count: arguments.length }; }
function ReturningPrimitive(a) { this.a = a; return 5; }
const Bound = Plain.bind(null, "bound"); Bound.prototype = Plain.prototype;
const Proxied = new Proxy(Plain, { construct(t, list, nt) { noted.push("construct " + list.length); return Reflect.construct(t, list, nt); } });
const parents = { Plain, Base, BaseWithRest, BaseWithDefaults, Returning, ReturningPrimitive, Bound, Proxied, Array, Map: class extends Map { constructor(x) { super(x); } }, Error, Object, Promise: class { constructor(...x) { this.x = x; } } };
const forms = {
    none: P => class None extends P { },
    forwarder: P => class Forwarder extends P { constructor(...args) { super(...args); } },
    withStores: P => class WithStores extends P { constructor(...args) { super(...args); this.state = { error: 0 }; this.reset = () => { this.state = { error: 1 }; }; } },
    withFields: P => class WithFields extends P { field = "f"; other = this.field + "!"; constructor(...args) { super(...args); this.late = this.field; } },
    written: P => class Written extends P { constructor(a, b) { super(a, b); } },
    first: P => class First extends P { constructor(first, ...args) { super(...args); this.first = first; } },
    extraBehind: P => class ExtraBehind extends P { constructor(...args) { super(...args, "extra"); } },
    extraAhead: P => class ExtraAhead extends P { constructor(...args) { super("ahead", ...args); } },
    twice: P => class Twice extends P { constructor(...args) { super(...args, ...args); } },
    kept: P => class Kept extends P { constructor(...args) { super(...args); this.args = args; } },
    read: P => class Read extends P { constructor(...args) { super(...args); this.count = args.length; this.zero = args[0]; } },
    pushed: P => class Pushed extends P { constructor(...args) { args.push("pushed"); super(...args); } },
    cut: P => class Cut extends P { constructor(...args) { args.length = 1; super(...args); } },
    ownIterator: P => class OwnIterator extends P { constructor(...args) { args[Symbol.iterator] = function* () { yield "iterated"; }; super(...args); } },
    copied: P => class Copied extends P { constructor(...args) { const copy = [...args]; super(...copy); } },
    inTry: P => class InTry extends P { constructor(...args) { try { super(...args); } catch (e) { noted.push("caught " + e.constructor.name); super(); } } },
    inArrow: P => class InArrow extends P { constructor(...args) { const go = () => super(...args); go(); } },
    conditional: P => class Conditional extends P { constructor(...args) { if (args.length > 1) super(...args); else super("few"); } },
    byArguments: P => class ByArguments extends P { constructor() { super(...arguments); } },
    thisAhead: P => class ThisAhead extends P { constructor(...args) { this.early = 1; super(...args); } },
    noSuper: P => class NoSuper extends P { constructor(...args) { noted.push(args.length); } },
    superTwice: P => class SuperTwice extends P { constructor(...args) { super(...args); super(...args); } },
    returnsObject: P => class ReturnsObject extends P { constructor(...args) { super(...args); return { mine: args.length }; } },
    deep: P => { class One extends P { constructor(...args) { super(...args); this.one = 1; } } class Two extends One { constructor(...args) { super(...args); this.two = 2; } } return class Three extends Two { constructor(...args) { super(...args); this.three = 3; } }; },
};
const lists = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5], [undefined, null], [[1, 2]], Array.from({ length: 12 }, (_, i) => i)];
function make(C, list) { switch (list.length) { case 0: return new C(); case 1: return new C(list[0]); case 2: return new C(list[0], list[1]); case 3: return new C(list[0], list[1], list[2]); default: return new C(...list); } }
function look(o) { return [Object.getPrototypeOf(o)?.constructor?.name, { ...o }, Array.isArray(o) ? [...o] : o instanceof Map ? [...o] : o instanceof Error ? o.message : 0]; }
for (const [parent, P] of Object.entries(parents))
    for (const [form, build] of Object.entries(forms)) {
        const C = build(P);
        for (const list of lists)
            attempt(parent + " | " + form + " | " + list.length, () => { noted.length = 0; const made = look(make(C, parent === "Map" ? [] : list)); return noted.length ? [made, noted.slice()] : made; });
    }
attempt("another new.target", () => { const C = forms.withStores(Base); class Other { } const o = Reflect.construct(C, [1, 2], Other); return [o.target, Object.getPrototypeOf(o) === Other.prototype, o.got, o.state]; });
attempt("the parent is changed", () => { const C = forms.forwarder(Base); const before = new C(1).got; Object.setPrototypeOf(C, BaseWithRest); return [before, new C(1, 2).got]; });
attempt("the parent is no constructor", () => { const C = forms.forwarder(Base); Object.setPrototypeOf(C, () => 0); return new C(1); });
attempt("the parent is null", () => { const C = forms.forwarder(Base); Object.setPrototypeOf(C, null); return new C(1); });
attempt("extends null", () => new (class extends null { constructor(...args) { super(...args); } })(1));
attempt("called without new", () => forms.forwarder(Base)(1));
attempt("many at one site", () => { let sum = 0; const classes = [forms.forwarder(Plain), forms.withStores(Plain), forms.none(Plain), forms.written(Plain)]; for (let i = 0; i < 400; i++) sum += new classes[i & 3](i, 1).got[0]; return sum; });
attempt("the parent throws", () => new (forms.withStores(class { constructor(a) { throw new RangeError("from the parent " + a); } }))(7));
console.log(lines.join("\n"));
