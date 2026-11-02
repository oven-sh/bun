// Members of a prototype object that Object.assign copies there or that a descriptor defines: before every lookup, after one, twice, on one path, on a holder that refuses, on one of many holders.
const out = [];
const say = (name, ...values) => out.push(name + ": " + values.map(value => (typeof value === "function" ? "function" : String(value))).join(" "));
const flag = globalThis.process !== undefined;
const attempt = action => { try { action(); return "completed"; } catch (error) { return error.name; } };

function Mixed(value) { this._value = value; }
Object.assign(Mixed.prototype, { double() { return this._value * 2; } }, { triple() { return this._value * 3; } });
Object.defineProperty(Mixed.prototype, "value", { get() { return this._value; }, set(value) { this._value = value + 1; } });
Object.defineProperty(Mixed.prototype, "half", { get() { return this._value / 2; } });
Object.defineProperty(Mixed.prototype, "describe", { value() { return "Mixed " + this._value; } });
const mixed = new Mixed(4);
mixed.value = 9;
say("store to a getter alone", attempt(() => { mixed.half = 100; }));
say("defined first", mixed.double(), mixed.triple(), mixed.value, mixed.half, mixed.describe(), Object.keys(mixed), "value" in mixed, mixed.hasOwnProperty("value"));
say("strict store to a getter alone", (function () { "use strict"; try { mixed.half = 1; return "stored"; } catch (error) { return error.name; } })());
say("enumeration", (function () { const names = []; for (const name in mixed) names.push(name); return names; })());

function StoredFirst() {}
const early = new StoredFirst();
early.value = 1;
say("before the definition", early.value, new StoredFirst().value);
Object.defineProperty(StoredFirst.prototype, "value", { get() { return "getter"; }, set(value) { this.seen = value; } });
const late = new StoredFirst();
late.value = 2;
say("after the definition", early.value, late.value, late.seen, Object.keys(early), Object.keys(late));

function ReadFirst() {}
const reader = new ReadFirst();
say("read first", reader.method, reader.accessor);
Object.assign(ReadFirst.prototype, { method() { return "method"; } });
Object.defineProperty(ReadFirst.prototype, "accessor", { get() { return "accessor"; } });
say("read later", reader.method(), reader.accessor);

function Twice() {}
Object.defineProperty(Twice.prototype, "value", { get() { return "first"; }, configurable: true });
const twice = new Twice();
say("first definition", twice.value);
Object.defineProperty(Twice.prototype, "value", { get() { return "second"; }, configurable: true });
say("second definition", twice.value);
delete Twice.prototype.value;
say("deleted", twice.value);

function Halves() {}
Object.defineProperty(Halves.prototype, "value", { get() { return this.stored; }, configurable: true });
const halves = new Halves();
say("getter alone", attempt(() => { halves.value = 1; }), halves.value, Object.keys(halves));
Object.defineProperty(Halves.prototype, "value", { set(value) { this.stored = value; } });
halves.value = 2;
say("both halves", halves.value, Object.keys(halves));

function OnePath() {}
if (flag) Object.defineProperty(OnePath.prototype, "value", { set(value) { this.seen = value; } });
const onePath = new OnePath();
onePath.value = 3;
say("one path", onePath.value, onePath.seen, Object.keys(onePath));

function Frozen() {}
Object.freeze(Frozen.prototype);
say("refused", Reflect.defineProperty(Frozen.prototype, "value", { get() { return 1; } }), new Frozen().value);
say("refused with a throw", (function () { try { Object.assign(Frozen.prototype, { method() {} }); return "assigned"; } catch (error) { return error.name; } })(), new Frozen().method);

function SameKey() {}
Object.assign(SameKey.prototype, { pick() { return "first"; } }, { pick() { return "second"; } });
say("same key", new SameKey().pick());

function Chosen() {}
Object.assign(Chosen.prototype, flag ? { pick() { return "taken"; } } : { other() { return "not taken"; } }, flag ? undefined : { third() {} });
say("chosen source", new Chosen().pick(), new Chosen().other, new Chosen().third);

function Shrunk() {}
const shrunk = { gone() {}, kept() { return "kept"; } };
delete shrunk.gone;
Object.defineProperty(shrunk, "hidden", { value() {}, enumerable: false });
Object.assign(Shrunk.prototype, shrunk);
say("source that changed", new Shrunk().gone, new Shrunk().kept(), new Shrunk().hidden);

function SetterAbove() {}
Object.defineProperty(SetterAbove.prototype, "method", { set(value) { this.taken = value; }, configurable: true });
Object.assign(SetterAbove.prototype, { method() { return "copied"; } });
say("assign runs a setter", new SetterAbove().method, typeof SetterAbove.prototype.taken);

function make(withSetter) {
  function Made() {}
  if (withSetter) Object.defineProperty(Made.prototype, "value", { set(value) { this.seen = value; } });
  return Made;
}
const made = [make(true), make(false)].map(Made => { const object = new Made(); object.value = 5; return Object.keys(object).join(); });
say("one of many holders", made);

function Shadowed() { Object.defineProperty(this, "value", { value: "own", writable: true }); }
Object.defineProperty(Shadowed.prototype, "value", { get() { return "inherited"; }, set() { throw new Error("setter"); } });
const shadowed = new Shadowed();
shadowed.value = "stored";
say("own property above an accessor", shadowed.value);

function Base() {}
Object.defineProperty(Base.prototype, "value", { get() { return "base " + this.name; }, set(value) { this.name = value; } });
function Derived() {}
Derived.prototype = Object.create(Base.prototype);
Object.assign(Derived.prototype, { shout() { return this.value.toUpperCase(); } });
const derived = new Derived();
derived.value = "d";
say("through two prototypes", derived.value, derived.shout(), Object.keys(derived));

let total = 0;
for (let i = 0; i < 1000; i++) { mixed.value = i; total += mixed.value + mixed.half + mixed.double(); }
say("loop", total);
console.log(out.join("\n"));
