// Functions that statements lay on the prototype of a class through a variable and an alias, called while objects hide them, others take their place and the prototype changes.
"use strict";
const out = [];
let P = {};
{ class Parser { constructor(text) { this.text = text; this.pos = 0; this.errors = []; } go(n) { let sum = 0; for (let i = 0; i < n; i++) { if (this.pos >= this.text.length) this.raise(this.pos, "end"); else sum += this.next(); } return sum + this.errors.length; } one() { return this.next() + this.peek(1); } } P = Parser; }
const pp = P.prototype;
pp.raise = function (pos, message) { this.errors.push(message + pos); this.pos = 0; return "raised"; };
pp.next = function () { return this.text.charCodeAt(this.pos++) | 0; };
pp.peek = function (n) { return this.text.charCodeAt(this.pos + n) | 0; };
pp.next = function () { return (this.text.charCodeAt(this.pos++) | 0) + 1; };
globalThis.kept = [P, pp];
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message.slice(0, 40); } out.push(name + " " + String(r)); };
const use = (name, p) => { for (let i = 0; i < 3; i++) { show(name + " go", () => P.prototype.go.call(p, 5 + i)); show(name + " one", () => p.one()); } show(name + " errors", () => p.errors.join()); };
use("plain", new P("some text"));
const own = new P("ab"); own.next = () => 1000; own.raise = function (pos) { this.errors.push("own" + pos); this.pos = 1; }; use("own", own);
const computed = new P("abc"); computed["ra" + "ise"] = () => "computed"; use("computed", computed);
const getter = new P("abcd"); let n = 0; Object.defineProperty(getter, "next", { get() { n++; return () => n; }, configurable: true }); use("getter", getter);
const none = new P("x"); none.next = undefined; use("undefined", none);
const heir = new (class extends P { next() { return super.next() + 100; } })("heir"); use("heir", heir);
use("foreign", Object.assign(Object.create(pp), { text: "foreign", pos: 2, errors: [] }));
pp.peek = function (n) { return -n; }; use("other function", new P("other"));
const saved = pp.raise; delete pp.raise; use("deleted", new P("de")); pp.raise = saved; use("laid again", new P("again"));
Object.defineProperty(pp, "peek", { get() { return (n) => n * 7; }, configurable: true }); use("accessor above", new P("accessor"));
Object.defineProperty(pp, "peek", { value: 5, writable: true, configurable: true }); use("no function", new P("none"));
Object.setPrototypeOf(pp, { peek: () => 3, extra: 1 }); delete pp.peek; use("further above", new P("above"));
const proxy = new Proxy(new P("proxy"), { get(t, k, r) { return k === "next" ? () => 2 : Reflect.get(t, k, r); } }); use("proxy", proxy);
Object.freeze(pp); try { pp.next = 1; } catch (e) { out.push("frozen " + e.constructor.name); } use("frozen", new P("frozen"));
for (const line of out) console.log(line);
