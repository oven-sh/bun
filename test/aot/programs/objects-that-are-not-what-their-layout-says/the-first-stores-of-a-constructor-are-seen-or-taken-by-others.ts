// A constructor function begins with plain stores: `this.flags = flags; this.id = id; ..`. Nothing seems to run between them. These cases let somebody see the object before they are through,
// or take a store away from the object: a setter, a constant or a proxy above it, another new.target, a call without `new`, a default of a parameter that hands `this` out, a heir, a constructor that leaves early.
declare const console: { log(...values: unknown[]): void };
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : typeof v === "number" && v !== v ? "#NaN" : v)); }

interface Kind { flags: number; id: number; name: string; on: boolean }
type KindConstructor = new (flags: number, id: number) => Kind;
function flagsOf(kind: Kind): number { return kind.flags; }
function idOf(kind: Kind): number { return kind.id; }
function nameOf(kind: Kind): string { return kind.name; }
function isOn(kind: Kind): boolean { return kind.on; }
function show(kind: Kind) { return [flagsOf(kind), idOf(kind), nameOf(kind), isOn(kind), Object.keys(kind).join()]; }
function warm(make: KindConstructor): number { let t = 0; for (let i = 0; i < 3000; i++) { const kind = new make(i & 7, i); t += flagsOf(kind) + idOf(kind) + nameOf(kind).length + (isOn(kind) ? 1 : 0); } return t; }
const define = (object: object, key: string, descriptor: PropertyDescriptor) => Object.defineProperty(object, [key][0], descriptor);

// A setter arrives above the object under the name of a first store.
{ const A = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "a" + id; this.on = id > 1; } as unknown as KindConstructor;
  say("A warm", warm(A)); const before = new A(1, 2); const seen: unknown[] = [];
  define(A.prototype, "id", { set(this: Kind, value: number) { seen.push([value, Object.keys(this).join(), flagsOf(this), nameOf(this)]); }, get() { return -5; }, configurable: true });
  const after = new A(3, 4); say("a setter above", [show(before), show(after), seen]);
  delete (A.prototype as any)[["id"][0]]; say("the setter is gone", [show(after), show(new A(5, 6))]); }
// A constant above the object: the store is refused.
{ const B = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "b" + id; this.on = id > 1; } as unknown as KindConstructor;
  say("B warm", warm(B)); define(B.prototype, "name", { value: "fixed", writable: false, configurable: true });
  let made: unknown; try { made = show(new B(1, 2)); } catch (error) { made = (error as Error).constructor.name; } say("a constant above", made); }
// A proxy above the object sees every store that finds no own property.
{ const C = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "c" + id; this.on = id > 1; } as unknown as KindConstructor;
  say("C warm", warm(C)); const seen: string[] = [];
  Object.setPrototypeOf(C.prototype, new Proxy({}, { set(_target, key, value, receiver) { seen.push(String(key) + ":" + Object.keys(receiver).join("+")); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } }));
  say("a proxy above", [show(new C(1, 2)), seen]); }
// Another new.target.
{ const D = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "d" + id; this.on = id > 1; } as unknown as KindConstructor;
  say("D warm", warm(D)); const seen: unknown[] = []; function Other() {} define(Other.prototype, "flags", { set(this: Kind, value: number) { seen.push([value, Object.keys(this).join()]); }, configurable: true });
  const made = Reflect.construct(D, [7, 8], Other) as Kind; say("another new.target", [show(made), seen, made instanceof D, made instanceof Other]); }
// A call without `new`, on whatever is handed in.
{ const E = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "e" + id; this.on = id > 1; } as unknown as KindConstructor & ((this: unknown, flags: number, id: number) => void);
  say("E warm", warm(E)); const plain = { id: "mine", extra: 1 } as unknown as Kind; (E as Function).call(plain, 1, 2); say("on a literal", show(plain));
  const frozen = Object.freeze({ flags: 9 }) as unknown as Kind; let result: unknown; try { (E as Function).call(frozen, 1, 2); result = "stored"; } catch (error) { result = (error as Error).constructor.name; } say("on a frozen literal", [result, Object.keys(frozen).join(), flagsOf(frozen)]);
  const old = new E(1, 1); (E as Function).call(old, "text", undefined); say("again on its own object, with other values", show(old)); }
// A default of a parameter runs before the first store and hands `this` out.
{ const early: unknown[] = []; let held: Kind | undefined;
  const F = function (this: Kind, flags: number, id: number = (held = this, early.push(show(this)), 40)) { this.flags = flags; this.id = id; this.name = "f" + id; this.on = id > 1; } as unknown as new (flags: number, id?: number) => Kind;
  let t = 0; for (let i = 0; i < 3000; i++) t += idOf(new F(i & 7, i)); say("F warm", t);
  const made = new F(2); say("a default that sees `this`", [early, show(made), held === made]); }
// A value that runs code when it is worked out, between two stores.
{ const between: unknown[] = [];
  const G = function (this: Kind, flags: number, source: { id: number }) { this.flags = flags; this.id = source.id; this.name = "g"; this.on = true; } as unknown as new (flags: number, source: { id: number }) => Kind;
  let t = 0; for (let i = 0; i < 3000; i++) t += idOf(new G(i & 7, { id: i })); say("G warm", t);
  let made: Kind | undefined; const Peek = function (this: Kind, flags: number) { made = this; G.call(this as never, flags, { get id() { between.push(show(made!)); return 12; } }); } as unknown as new (flags: number) => Kind; Peek.prototype = G.prototype;
  say("a getter between two stores", [show(new Peek(3)), between]); }
// A heir whose own fields come behind, and one that looks before super() is through.
{ const H = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.name = "h" + id; this.on = id > 1; } as unknown as KindConstructor;
  say("H warm", warm(H)); class Heir extends H { extra = flagsOf(this) + 100; } const heir = new Heir(1, 2); say("a heir", [show(heir), heir.extra]); }
// A constructor that leaves early, throws, or answers another object.
{ const I = function (this: Kind, flags: number, id: number) { this.flags = flags; if (id < 0) return; this.id = id; if (id === 0) throw new RangeError("zero"); this.name = "i" + id; this.on = id > 1; if (id === 99) return { flags: -1, id: -1, name: "other", on: false }; } as unknown as KindConstructor;
  say("I warm", warm(function (this: Kind, flags: number, id: number) { return new I(flags, id + 1); } as unknown as KindConstructor));
  say("it leaves early", show(new I(1, -1))); let thrown: unknown; try { new I(1, 0); } catch (error) { thrown = (error as Error).message; } say("it throws", thrown); say("it answers another object", show(new I(1, 99))); }
// Chains and stores of one value under two names.
{ const J = function (this: Kind & { copy: number }, flags: number, id: number) { this.flags = this.copy = flags; this.id = id; this.name = "j"; this.on = false; } as unknown as new (flags: number, id: number) => Kind & { copy: number };
  let t = 0; for (let i = 0; i < 3000; i++) t += new J(i & 7, i).copy; say("J warm", t); say("a chain", [show(new J(4, 5)), new J(4, 5).copy]); }
console.log(lines.join("\n"));
