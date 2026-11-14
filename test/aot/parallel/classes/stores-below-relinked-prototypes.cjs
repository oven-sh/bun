// What stands above a class prototype may stop stores of the constructor, from the start or later on.
"use strict";
const log = [];
const show = (label, make) => { let text; try { const made = make(); text = Object.keys(made).join() + " " + made.pos + " " + made.kind; } catch (error) { text = error.name + ": " + error.message; } log.push(label + ": " + text); };
const times = (label, make) => { for (let i = 0; i < 3; i++) show(label, make); };
const makeClass = {
    a() { return class Point { constructor(pos, kind) { this.pos = pos; this.kind = kind; } sum() { return this.pos + this.kind; } }; },
};
class SetterLater { constructor(pos, kind) { this.pos = pos; this.kind = kind; } }
const aboveSetterLater = { name: "above" };
Object.setPrototypeOf(SetterLater.prototype, aboveSetterLater);
times("before", () => new SetterLater(1, 2));
Object.defineProperty(aboveSetterLater, "pos", { set(value) { log.push("set pos " + value); }, get() { return "got"; }, configurable: true });
times("setter later", () => new SetterLater(1, 2));
delete aboveSetterLater.pos;
times("setter gone", () => new SetterLater(1, 2));

class SetterFirst { constructor(pos, kind) { this.pos = pos; this.kind = kind; } }
Object.setPrototypeOf(SetterFirst.prototype, { set kind(value) { log.push("set kind " + value); } });
times("setter first", () => new SetterFirst(1, 2));

class ReadOnly { constructor(pos, kind) { this.pos = pos; this.kind = kind; } }
const aboveReadOnly = { pos: 5 };
Object.setPrototypeOf(ReadOnly.prototype, aboveReadOnly);
times("plain value above", () => new ReadOnly(1, 2));
Object.freeze(aboveReadOnly);
times("frozen above", () => new ReadOnly(1, 2));

class Twice { constructor(pos, kind) { this.pos = pos; this.kind = kind; } own() { return "own"; } }
Object.setPrototypeOf(Twice.prototype, { first() { return "first"; } });
times("linked once", () => new Twice(1, 2));
log.push(new Twice(1, 2).first(), new Twice(1, 2).own());
Object.setPrototypeOf(Twice.prototype, { set pos(value) { log.push("second set " + value); }, own() { return "other"; } });
times("linked twice", () => new Twice(1, 2));
log.push(typeof new Twice(1, 2).first, new Twice(1, 2).own());

class ThroughProxy { constructor(pos, kind) { this.pos = pos; this.kind = kind; } }
Object.setPrototypeOf(ThroughProxy.prototype, new Proxy({}, { set(target, key, value, receiver) { log.push("proxy " + String(key)); return Reflect.set(target, key, value, receiver); } }));
times("proxy", () => new ThroughProxy(1, 2));

class Deep { constructor(pos, kind) { this.pos = pos; this.kind = kind; } }
const deepest = Object.create(null);
Object.setPrototypeOf(Deep.prototype, Object.create(Object.create(deepest)));
times("deep", () => new Deep(1, 2));
Object.defineProperty(deepest, "kind", { value: 9, writable: false, configurable: true });
times("deep read-only", () => new Deep(1, 2));
Object.setPrototypeOf(Deep.prototype, null);
times("deep null", () => new Deep(1, 2));

class Parent { constructor(pos) { this.pos = pos; } who() { return "parent"; } }
class Heir extends Parent { constructor(pos, kind) { super(pos); this.kind = kind; } whoAbove() { return super.who(); } }
const other = { who() { return "other"; } };
times("heir", () => new Heir(1, 2));
Object.setPrototypeOf(Heir.prototype, other);
times("heir below other", () => new Heir(1, 2));
log.push(new Heir(1, 2).who(), new Heir(1, 2).whoAbove(), new Heir(1, 2) instanceof Parent);
Object.setPrototypeOf(Parent.prototype, { set pos(value) { log.push("never " + value); } });
times("parent relinked", () => new Heir(1, 2));
Object.defineProperty(other, "pos", { set(value) { log.push("other pos " + value); }, configurable: true });
times("other gets setter", () => new Heir(1, 2));

class Top { constructor(pos) { this.pos = pos; } }
class Middle extends Top { constructor(pos, kind) { super(pos); this.kind = kind; } }
class Bottom extends Middle { constructor(pos, kind) { super(pos, kind); this.last = 1; } }
times("bottom", () => new Bottom(1, 2));
const aboveTop = {};
Object.setPrototypeOf(Top.prototype, aboveTop);
times("bottom relinked", () => new Bottom(1, 2));
Object.defineProperty(aboveTop, "last", { set(value) { log.push("last " + value); } });
times("bottom last", () => new Bottom(1, 2));
Object.defineProperty(aboveTop, "kind", { get() { return 1; } });
times("bottom kind", () => new Bottom(1, 2));

const Made = makeClass.a();
Object.setPrototypeOf(Made.prototype, aboveTop);
times("made", () => new Made(1, 2));
console.log(log.join("\n"));
