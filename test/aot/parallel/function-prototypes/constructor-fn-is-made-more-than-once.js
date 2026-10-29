// Every row has a factory of its own: what one row tells the run time about a function says nothing in the next.
// The function that makes a constructor function runs more than once: in a factory, in a loop, in a mixin. Each run makes another function with another prototype object, and what one of them has under a name says nothing of the others: a setter, a property that cannot be written, a method that has captured another value, another parent. As in plain Bun.
const log = [];
function row(what, f) { log.length = 0; let answer; try { answer = f(); } catch (e) { answer = "threw " + e.name; } console.log(what + ": " + JSON.stringify(answer) + (log.length ? " | " + log.join() : "")); }
function seen(o) { return [Object.keys(o).join(), o.url, JSON.stringify(o), Object.keys({ ...o }).join()]; }
function many(C) { let last; for (let i = 0; i < 40; i++) last = new C("/" + i); return last; }

function withSetter(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("a setter on the second", () => { const First = withSetter(false); const a = many(First); const Second = withSetter(true); return [seen(a), seen(new Second("/second")), seen(new First("/first"))]; });
function withSetter2(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("a setter on the first", () => { const First = withSetter2(true); const a = many(First); log.length = 0; const Second = withSetter2(false); return [seen(a), seen(new Second("/second")), seen(new First("/first"))]; });
function withSetter3(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("both made before the first object", () => { const First = withSetter3(false), Second = withSetter3(true); return [seen(new First("/first")), seen(new Second("/second")), seen(many(First)), seen(many(Second)).slice(0, 2)]; });

function notWritable(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { value: "fixed", writable: false, configurable: true });
  return Message;
}
row("not writable on the second", () => { const First = notWritable(false); many(First); const Second = notWritable(true); return seen(new Second("/second")); });

function replaced(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Message.prototype = { set url(v) { log.push("set " + v); }, get url() { return "getter"; }, kind: "replaced" };
  return Message;
}
row("the second prototype object is replaced", () => { const First = replaced(false); many(First); const Second = replaced(true); const b = new Second("/second"); return [seen(b), b.kind, new First("/first").kind, b instanceof Second, b instanceof First]; });

function above(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.setPrototypeOf(Message.prototype, { set url(v) { log.push("set " + v); }, get url() { return "getter"; } });
  return Message;
}
row("a setter above the second prototype object", () => { const First = above(false); many(First); const Second = above(true); return [seen(new Second("/second")), seen(new First("/first"))]; });

function later() { function Message(url) { this.id = 1; this.url = url; } return Message; }
row("a setter that comes when the second has objects", () => { const First = later(); many(First); const Second = later(); const early = many(Second); Object.defineProperty(Second.prototype, "url", { set(v) { log.push("set " + v); }, configurable: true }); return [seen(early), seen(new Second("/second")), seen(new First("/first"))]; });

function tagged(tag) {
  function Named() { this.own = 1; }
  Named.prototype.name = function () { return tag; };
  Named.prototype.tag = tag;
  Object.defineProperty(Named.prototype, "got", { get() { return "got " + tag; }, configurable: true });
  return Named;
}
row("methods that have captured another value", () => { const A = tagged("a"), B = tagged("b"); let s = ""; for (let i = 0; i < 40; i++) { const x = new (i % 2 ? A : B)(); s = x.name() + x.tag + x.got; } const a = new A(), b = new B(); return [s, a.name(), b.name(), a.tag, b.tag, a.got, b.got, a.name === b.name, a instanceof B, b instanceof B, Object.getPrototypeOf(a) === Object.getPrototypeOf(b)]; });

function withSetter4(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("made in a loop", () => { const list = []; for (let i = 0; i < 4; i++) list.push(withSetter4(i === 2)); return list.map((C, i) => seen(new C("/" + i)).slice(0, 2)); });
function withSetter5(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("made in a loop, each used at once", () => { const out = []; for (let i = 0; i < 4; i++) { const C = withSetter5(i % 2 === 1); out.push(seen(many(C)).slice(0, 2)); log.length = 0; } return out; });

function mix(Base, has) {
  function Derived(url) { Base.call(this, url); this.more = 2; }
  Derived.prototype = Object.create(Base.prototype, has ? { more: { set(v) { log.push("set more " + v); }, get() { return "more getter"; }, configurable: true } } : {});
  Derived.prototype.constructor = Derived;
  return Derived;
}
function withSetter6(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("a mixin over two bases", () => { const One = mix(withSetter6(false), false), Two = mix(withSetter6(true), true); const a = many(One), b = new Two("/two"); return [seen(a), a.more, seen(b), b.more, a instanceof One, b instanceof One, b instanceof Two]; });

function withSetter7(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("another new.target", () => { const First = withSetter7(false), Second = withSetter7(true); many(First); const a = Reflect.construct(First, ["/x"], Second), b = Reflect.construct(Second, ["/y"], First); return [seen(a), seen(b), a instanceof Second, a instanceof First, b instanceof First]; });

function classes(has) { return has ? class Message { constructor(url) { this.id = 1; this.url = url; } set url(v) { log.push("set " + v); } get url() { return "getter"; } } : class Message { constructor(url) { this.id = 1; this.url = url; } }; }
function oneClass(has) { class Message { constructor(url) { this.id = 1; this.url = url; } } if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true }); return Message; }
row("two classes", () => { const First = classes(false); many(First); const Second = classes(true); return [seen(new Second("/second")), seen(new First("/first"))]; });
row("one class evaluated twice", () => { const First = oneClass(false); many(First); const Second = oneClass(true); return [seen(new Second("/second")), seen(new First("/first"))]; });

function counted() { function Counter() { this.n = 0; } Counter.prototype.step = function () { return ++this.n; }; return Counter; }
row("reads and calls on objects of both", () => { const A = counted(), B = counted(); B.prototype.step = function () { return this.n -= 1; }; const list = [new A(), new B(), new A(), new B()]; let s = 0; for (let r = 0; r < 30; r++) for (const c of list) s += c.step(); return [s, list.map(c => c.n)]; });

function withSetter8(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("the first is collected before the second is made", () => { (function () { many(withSetter8(false)); })(); Bun.gc(true); Bun.gc(true); const Second = withSetter8(true); const b = seen(new Second("/second")); const Third = withSetter8(false); return [b, seen(many(Third))]; });

function capturing(tag, has) {
  function Message(url) { this.id = tag; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + tag + v); }, get() { return "getter " + tag; }, configurable: true });
  return Message;
}
row("constructor functions that have captured a value", () => { const First = capturing(1, false); const a = many(First); const Second = capturing(2, true); return [seen(a), seen(new Second("/second")), seen(new First("/first"))]; });

function withSetter9(has) {
  function Message(url) { this.id = 1; this.url = url; }
  if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  return Message;
}
row("classes that extend both", () => { class One extends withSetter9(false) { constructor(url) { super(url); this.more = 1; } } class Two extends withSetter9(true) { constructor(url) { super(url); this.more = 2; } } return [seen(many(One)), seen(new Two("/two")), new Two("/x") instanceof One]; });

function later2() { function Message(url) { this.id = 1; this.url = url; } return Message; }
row("taken in turn out of a list, the second untouched until it constructs", () => { const list = [later2(), later2(), later2()]; const out = []; for (let round = 0; round < 3; round++) for (const C of list) out.push(Object.keys(new C("/" + round)).join()); Object.defineProperty(list[1].prototype, "url", { set(v) { log.push("set " + v); }, configurable: true }); for (const C of list) out.push(Object.keys(new C("/last")).join()); return out.join(" "); });

function later3() { function Message(url) { this.id = 1; this.url = url; } return Message; }
row("a setter that comes in the middle of a loop over both", () => { const A = later3(), B = later3(); const out = []; for (let i = 0; i < 6; i++) { if (i === 3) Object.defineProperty(B.prototype, "url", { set(v) { log.push("set " + v); }, configurable: true }); out.push(Object.keys(new A("/a" + i)).join() + ";" + Object.keys(new B("/b" + i)).join()); } return out.join(" "); });

function inherited(has) { function Message() { this.id = 1; } if (has) Message.prototype.extra = "of the second"; return Message; }
row("a name that only the second prototype object has", () => { const First = inherited(false); let a; for (let i = 0; i < 40; i++) a = new First(); const b = new (inherited(true))(); return [a.extra, b.extra, "extra" in a, "extra" in b, new First().extra]; });

function calledToo(has) { function Message(url) { if (!(this instanceof Message)) return new Message(url); this.id = 1; this.url = url; } if (has) Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, configurable: true }); return Message; }
row("a function that constructs itself when it is called", () => { const First = calledToo(false); let a; for (let i = 0; i < 40; i++) a = First("/" + i); const Second = calledToo(true); return [Object.keys(a).join(), Object.keys(Second("/second")).join(), Object.keys(First("/first")).join(), Second("/x") instanceof First]; });
