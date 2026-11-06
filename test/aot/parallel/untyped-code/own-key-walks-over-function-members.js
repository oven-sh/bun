// Functions in fields under `JSON.stringify`, `Object.values`, `Object.entries`, spread and `Object.assign`: the walks hand out the same function object as a read, and a function that gets a `toJSON` by any route (a store, a computed key, a definition, `Object.assign`, a getter, another prototype, through a parameter or an array) is written by it from then on.
// STATISTIC: OwnKeyWalksExpanded >= 10
{
class A { x = 1; f = () => this.x; g = () => 7 }
function text(o) { return JSON.stringify(o) }
function run() { const a = new A(); const t = text(a); const f = a.f; a.x = 9; console.log(t + " " + f() + " " + (f === a.f) + " " + a.g() + " " + text(a)) }
run(); run(); run()
}
{
class A { x = 1; f = () => this.x; g = () => 7 }
function copy(o) { return Object.assign({}, o) }
function run() { const a = new A(); const c = copy(a); a.x = 5; console.log(typeof c.f + " " + (c.f === a.f) + " " + c.f() + " " + c.g() + " " + c.x + " " + JSON.stringify(c)) }
run(); run(); run()
}
{
class A { constructor(k) { this.k = k; this.add = n => this.k + n } }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(k); const t = text(a); console.log(t + " " + a.add(1) + " " + a.add("s")) }
run(0); run(1); run(2)
}
{
class T { static toJSON(key) { return "static " + key } }
class U extends T {}
class V {}
class A { t = T; u = U; v = V; x = 1 }
function text(o) { return JSON.stringify(o) }
function run() { console.log(text(new A())) }
run(); run(); run()
}
{
function text(o) { return JSON.stringify(o) }
function run(k) { const f = () => k; const l = [f, () => 2, f]; if (k === 1) f.toJSON = i => "element " + i; console.log(text(l) + " " + text({ l })) }
run(0); run(1); run(2)
}
{
class A { x = 1; f = () => this.x; g = () => 7 }
function entries(o) { return Object.entries(o) }
function run() { const a = new A(); const e = entries(a); let s = ""; for (let i = 0; i < e.length; i++) s += e[i][0] + ":" + typeof e[i][1] + " "; console.log(s + (e[1][1] === a.f) + " " + e[1][1]() + " " + e[2][1]()) }
run(); run(); run()
}
{
let current
class B { toJSON() { delete current.f; return "b" } }
class A { x = 1; b = new B(); f = () => this.x; y = 2 }
A.prototype.f = "inherited"
function text(o) { return JSON.stringify(o) }
function run() { current = new A(); console.log(text(current)) }
run(); run(); run()
}
{
let current
class B { toJSON() { Object.defineProperty(current, "f", { get() { return "got" }, enumerable: true }); return "b" } }
class A { x = 1; b = new B(); f = () => this.x; y = 2 }
function text(o) { return JSON.stringify(o) }
function run() { current = new A(); console.log(text(current)) }
run(); run(); run()
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); const before = text(a); if (k) a.f.toJSON = key => "late " + key; console.log(before + " " + text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
const other = { toJSON(key) { return "by __proto__ " + key } }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) a.f.__proto__ = other; console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
const other = { toJSON(key) { return "inherited " + key } }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Object.setPrototypeOf(a.f, other); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
const other = { toJSON(key) { return "by Reflect " + key } }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Reflect.setPrototypeOf(a.f, other); console.log(text(a)) }
run(0); run(1); run(0)
}
{
let current
class B { toJSON() { current.f = "text now"; return "b" } }
class A { x = 1; b = new B(); f = () => this.x; y = 2 }
function text(o) { return JSON.stringify(o) }
function run() { current = new A(); console.log(text(current)) }
run(); run(); run()
}
{
const shared = () => 1
class A { f = shared; x = 1 }
class B { g = shared; y = 2 }
function textA(o) { return JSON.stringify(o) }
function textB(o) { return JSON.stringify(o) }
function run(k) { if (k === 1) shared.toJSON = key => "shared " + key; console.log(textA(new A()) + " " + textB(new B())) }
run(0); run(1); run(2)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Object.assign(a.f, { toJSON: key => "assigned " + key }); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function name() { return "to" + "JSON" }
function run(k) { const a = new A(); if (k) a.f[name()] = key => "computed " + key; console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Object.defineProperties(a.f, { toJSON: { value: key => "defined all " + key } }); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Object.defineProperty(a.f, "toJSON", { value: key => "defined " + key }); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Reflect.set(a.f, "toJSON", key => "reflected " + key); console.log(text(a)) }
run(0); run(1); run(0)
}
{
let current
class B { toJSON() { current.f.toJSON = key => "meanwhile " + key; return "b" } }
class A { x = 1; b = new B(); f = () => this.x; y = 2 }
function text(o) { return JSON.stringify(o) }
function run() { current = new A(); console.log(text(current)) }
run(); run(); run()
}
{
class A { x = 1; f = () => this.x }
let reads = 0
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) Object.defineProperty(a.f, "toJSON", { get() { reads++; return undefined } }); console.log(text(a) + " " + reads) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) { const c = { ...a }; c.f.toJSON = key => "from a copy " + key } console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) { const v = Object.values(a); v[1].toJSON = key => "from values " + key } console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = function self() { self.toJSON = key => "by itself " + key } }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) a.f(); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function mark(fn) { fn.toJSON = key => "marked " + key }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); if (k) mark(a.f); console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
const box = []
function run(k) { const a = new A(); box[0] = a.f; if (k) box[k - 1].toJSON = key => "boxed " + key; console.log(text(a)) }
run(0); run(1); run(0)
}
{
class A { never = () => { console.log("never") }; x = 1 }
function text(o) { return JSON.stringify(o) }
function run(k) { const a = new A(); console.log(text(a) + " " + typeof a.never + " " + a.never.name + " " + a.never.length) }
run(0); run(1); run(2)
}
{
class A { x = 1; f = () => this.x; g = () => 7 }
function copy(o) { return { ...o } }
function run() { const a = new A(); const c = copy(a); a.x = 5; console.log(typeof c.f + " " + (c.f === a.f) + " " + c.f() + " " + c.g() + " " + c.x + " " + JSON.stringify(c) + " " + Object.keys(c).length) }
run(); run(); run()
}
{
let calls = 0
const original = Function.prototype.toString
class A { x = 1; f = () => this.x }
function text(o) { return JSON.stringify(o) }
function run(k) { if (k === 1) { try { Function.prototype.toString = function () { calls++; return "replaced" } } catch (e) { console.log("threw " + e.name) } } console.log(text(new A()) + " " + calls + " " + ("" + new A().f).length) }
run(0); run(1); run(2)
}
{
class A { x = 1; f = () => this.x; g = () => 7 }
function values(o) { return Object.values(o) }
function run() { const a = new A(); const v = values(a); console.log(v.length + " " + typeof v[1] + " " + (v[1] === a.f) + " " + (v[2] === a.g) + " " + v[1]() + " " + v[2]() + " " + (values(a)[1] === v[1])) }
run(); run(); run()
}
