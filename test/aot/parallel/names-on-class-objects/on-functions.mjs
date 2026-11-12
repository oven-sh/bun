// Names that the program stores on functions: whoever reads them, under whatever name, gets what was stored last.
const lines = [];
function say(...values) { lines.push(values.map(value => typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)).join(" ")); }
class Service { constructor(x) { this.x = x; } add(y) { return this.x + y; } }
function Plain() { }
Plain.one = new Service(1);
say("read", Plain.one.add(2), Plain.two, typeof Plain.one);
function bump() { Plain.count = (Plain.count ?? 0) + 1; return Plain.count; }
say("count", bump(), bump(), Plain.count * 2);
Plain.count = "text";
say("text", Plain.count + 1);
class Single { static get() { if (!Single.only) Single.only = new Service(5); return Single.only; } }
say("single", Single.get().add(1), Single.get() === Single.get());
Single.only.x = "changed";
say("changed", Single.get().add(1));
class Base { static make() { return new this(); } }
class Heir extends Base { }
Base.shared = new Service(7);
say("inherited", Heir.shared.add(1), Object.hasOwn(Heir, "shared"));
Heir.shared = new Service("own");
say("own", Heir.shared.add(1), Base.shared.add(1));
class Deep extends Heir { static read() { return super.shared.add(2) + this.shared.add(3); } }
say("super", Deep.read());
Base.call1 = function (y) { return this === Base ? "base" + y : this === Heir ? "heir" + y : "other" + y; };
say("called", Base.call1(1), Heir.call1(2), Deep.call1(3));
Base.later = y => y + 1;
say("arrow", Base.later(1), Heir.later(2));
Heir.later = y => "heir" + y;
say("shadowed", Base.later(1), Heir.later(2), Deep.later(3));
class WithSetter { static set level(value) { this.held = value * 2; } static get level() { return this.held; } }
class BelowSetter extends WithSetter { }
BelowSetter.level = 4;
say("setter", BelowSetter.level, BelowSetter.held, WithSetter.held, Object.keys(BelowSetter).join());
function Deleted() { }
Deleted.a = new Service(1);
delete Deleted.a;
say("deleted", Deleted.a, "a" in Deleted);
function Defined() { }
Defined.a = new Service(1);
Object.defineProperty(Defined, "a", { get() { return new Service("got"); }, configurable: true });
say("getter", Defined.a.add(1));
Object.defineProperty(Defined, "b", { value: new Service(8), configurable: true });
say("defined", Defined.b.add(1));
function Assigned() { }
Object.assign(Assigned, { a: new Service(9), b: 2 });
say("assigned", Assigned.a.add(Assigned.b));
Assigned.b = "t";
say("assigned text", Assigned.a.add(Assigned.b));
function Frozen() { }
Frozen.a = 1;
Object.freeze(Frozen);
try { "use strict"; Frozen.a = 2; } catch (error) { say("frozen", error.constructor.name); }
say("frozen", Frozen.a);
function Linked() { }
Linked.a = 1;
Object.setPrototypeOf(Linked, { b: new Service(10), a: 3 });
say("linked", Linked.a, Linked.b.add(1));
function Listed() { }
Listed.a = new Service(11);
Listed.b = new Service(12);
say("listed", Object.keys(Listed), Object.entries(Listed), { ...Listed });
for (const value of Object.values(Listed)) value.x = "v" + value.x;
say("values", Listed.a.add(1), Listed.b.x);
let names = "";
for (const name in Listed) names += name + Listed[name].x;
say("for in", names);
function Keyed() { }
Keyed["a" + (process.argv[9] ?? "b")] = new Service(13);
Keyed.cd = new Service(14);
say("keyed", Keyed.ab.add(1), Keyed["c" + (process.argv[9] ?? "d")].add(1));
Keyed["c" + (process.argv[9] ?? "d")].x = "under";
say("under", Keyed.cd.add(1));
say("reflect", Reflect.get(Listed, "a").x, Reflect.set(Listed, "a", new Service("set")), Listed.a.add(1), Reflect.ownKeys(Listed));
const proxied = new Proxy(function Inner() { }, { get(target, key) { return key === "a" ? new Service("trapped") : target[key]; }, set(target, key, value) { target[key] = value; return true; } });
proxied.b = new Service(15);
say("proxy", proxied.a.x, proxied.b.add(1));
class Counted { constructor() { this.constructor.made = (this.constructor.made ?? 0) + 1; } }
class CountedBelow extends Counted { }
new Counted(); new CountedBelow(); new CountedBelow();
say("constructor", Counted.made, CountedBelow.made, Object.hasOwn(CountedBelow, "made"));
function make(tag) { function Made() { } Made.tag = tag; Made.held = new Service(tag); return Made; }
const first = make(1), second = make("two");
say("made", first.tag, second.tag, first.held.add(1), second.held.add(1));
const classes = [function A() { }, function B() { }, function C() { }];
classes.forEach((held, index) => { held.index = index; held.service = new Service(index); });
say("classes", classes.map(held => held.index + held.service.add(1)));
classes[1].service.x = "x";
say("classes", classes.map(held => held.service.add(1)));
class Target { constructor() { this.seen = new.target.mark; } }
class TargetBelow extends Target { }
Target.mark = "m";
TargetBelow.mark = 2;
say("target", new Target().seen, new TargetBelow().seen);
function Named() { }
Named.toString = () => "named";
Named.call = y => "call" + y;
say("over", String(Named), Named.call(1), Named.apply === Function.prototype.apply);
function Sealed() { }
Object.preventExtensions(Sealed);
try { Sealed.a = 1; say("sealed", Sealed.a); } catch (error) { say("sealed", error.constructor.name); }
class Declared { static a = new Service(1); }
class DeclaredBelow extends Declared { }
DeclaredBelow.a = new Service("below");
say("declared", Declared.a.add(1), DeclaredBelow.a.add(1));
const held = globalThis["hold" + (process.argv[9] ?? "")] = value => { globalThis.kept = value; };
function Escaped() { }
Escaped.a = new Service(1);
globalThis["hold" + (process.argv[9] ?? "")](Escaped);
globalThis.kept.a.x = "far";
globalThis.kept.b = new Service("b");
say("escaped", Escaped.a.add(1), Escaped.b.add(1));
function Symbols() { }
const symbol = Symbol("s");
Symbols[symbol] = new Service(16);
say("symbol", Symbols[symbol].add(1));
class Method { static run() { return this.helper?.(1) ?? "none"; } }
say("helper", Method.run());
Method.helper = y => new Service(y).add(1);
say("helper", Method.run());
let total = 0;
function Loop() { }
for (let turn = 0; turn < 300; turn++) { Loop.last = new Service(turn); total += Loop.last.add(turn) + (Loop.sum = (Loop.sum ?? 0) + 1); }
say("loop", total, Loop.sum, Loop.last.x);
say("function", (function () { function Local() { } Local.a = new Service(17); Local.n = 0; for (let i = 0; i < 5; i++) Local.n += i; return Local.a.add(Local.n); })());
say("json", JSON.stringify({ c: Listed }) ?? "undefined", structuredCloneOf(Plain));
function structuredCloneOf(value) { try { return structuredClone(value); } catch (error) { return error.name; } }
console.log(lines.join("\n"));
