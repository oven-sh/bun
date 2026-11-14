// What instances find by their constructor: classes below built-ins, below mixins and below neither, and what changes on the way.
const lines = []; let hash = 0;
function one(v) { return typeof v === "symbol" ? "symbol" : typeof v === "function" ? "f:" + v.name : v && typeof v === "object" ? (Array.isArray(v) ? "[" + v.length + "]" : "{}") : Object.is(v, -0) ? "-0" : String(v); }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 300) lines.push(s); }
function tried(title, run) { try { note(title + " " + one(run())); } catch (e) { note(title + " " + e.name); } }
globalThis.box = [0];
function hide(x) { globalThis.box[0] = x; return globalThis.box[0]; }
let counted = 0;

const members = Base => class Made extends Base {
  static isMade(v) { return v != null && v.k === 1; }
  static get kind() { counted++; return "kind"; }
  static get [Symbol.species]() { return this; }
  static check(v) { return this.isMade(v) ? 1 : 2; }
  probe(v) { return this.constructor.isMade(v); }
  checked(v) { return this.constructor.check(v); }
  kindOf() { return this.constructor.kind; }
  species() { return this.constructor[Symbol.species]; }
  same(v) { return this.constructor === v; }
};
class OfArray extends Array { static isMade(v) { return v != null && v.k === 1; } static get kind() { counted++; return "array"; } static get [Symbol.species]() { return this; } static check(v) { return this.isMade(v) ? 1 : 2; } probe(v) { return this.constructor.isMade(v); } checked(v) { return this.constructor.check(v); } kindOf() { return this.constructor.kind; } species() { return this.constructor[Symbol.species]; } same(v) { return this.constructor === v; } }
class OfMap extends Map { static isMade(v) { return v != null && v.k === 1; } static get kind() { counted++; return "map"; } static get [Symbol.species]() { return Map; } static check(v) { return this.isMade(v) ? 1 : 2; } probe(v) { return this.constructor.isMade(v); } checked(v) { return this.constructor.check(v); } kindOf() { return this.constructor.kind; } species() { return this.constructor[Symbol.species]; } same(v) { return this.constructor === v; } }
class OfBytes extends Uint8Array { static isMade(v) { return v != null && v.k === 1; } static get kind() { counted++; return "bytes"; } static get [Symbol.species]() { return Uint8Array; } static check(v) { return this.isMade(v) ? 1 : 2; } probe(v) { return this.constructor.isMade(v); } checked(v) { return this.constructor.check(v); } kindOf() { return this.constructor.kind; } species() { return this.constructor[Symbol.species]; } same(v) { return this.constructor === v; } }
class Below extends OfArray { constructor(n) { super(n); this.n = n; } static check(v) { return super.check(v) + 10; } }
const mixed = members;
class Mixed extends mixed(Object) { constructor() { super(); this.a = 1; } }
class MixedArray extends mixed(Array) { constructor(n) { super(n); this.rows = n; } }
class Plain { static isMade(v) { return v != null && v.k === 1; } static get kind() { counted++; return "plain"; } static get [Symbol.species]() { return this; } static check(v) { return this.isMade(v) ? 1 : 2; } probe(v) { return this.constructor.isMade(v); } checked(v) { return this.constructor.check(v); } kindOf() { return this.constructor.kind; } species() { return this.constructor[Symbol.species]; } same(v) { return this.constructor === v; } }

const makers = { array: () => new OfArray(3), map: () => new OfMap([[1, 2]]), bytes: () => new OfBytes(4), below: () => new Below(2), mixed: () => new Mixed(), mixedArray: () => new MixedArray(2), plain: () => new Plain() };
const classes = { array: OfArray, map: OfMap, bytes: OfBytes, below: Below, mixed: Mixed, mixedArray: MixedArray, plain: Plain };
const reads = {
  probe: (x, v, n) => { let s = 0; for (let i = 0; i < n; i++) s += x[i % x.length].probe(v) ? 1 : 100; return s; },
  checked: (x, v, n) => { let s = 0; for (let i = 0; i < n; i++) s += x[i % x.length].checked(v); return s; },
  kindOf: (x, v, n) => { let s = ""; for (let i = 0; i < n; i++) s += x[i % x.length].kindOf(); return s; },
  species: (x, v, n) => { let s = ""; for (let i = 0; i < n; i++) s += one(x[i % x.length].species()); return s; },
  same: (x, v, n) => { let s = 0; for (let i = 0; i < n; i++) s += x[i % x.length].same(v) ? 1 : 3; return s; },
  direct: (x, v, n) => { let s = 0; for (let i = 0; i < n; i++) s += x[i % x.length].constructor.isMade(v) ? 1 : 100; return s; },
};
const changes = {
  nothing: () => 0,
  own: (C, x) => { x.constructor = Plain; },
  ownAccessor: (C, x) => { Object.defineProperty(x, "constructor", { get() { counted += 100; return OfArray; }, configurable: true }); },
  prototype: (C, x) => { Object.setPrototypeOf(x, Plain.prototype); },
  holder: C => { C.prototype.constructor = Plain; },
  holderAccessor: C => { Object.defineProperty(C.prototype, "constructor", { get() { counted += 1000; return Plain; }, configurable: true }); },
  holderGone: C => { delete C.prototype.constructor; },
  method: C => { C.isMade = v => v === 5; },
  methodAccessor: C => { Object.defineProperty(C, "isMade", { get() { counted += 7; return () => true; }, configurable: true }); },
  methodGone: C => { delete C.isMade; delete C.check; },
  getter: C => { Object.defineProperty(C, "kind", { value: "value", configurable: true }); },
  speciesGone: C => { delete C[Symbol.species]; },
  above: C => { Object.setPrototypeOf(C, Plain); },
  aboveGone: C => { Object.setPrototypeOf(C, null); },
  name: C => { C.late = 1; C.check = undefined; },
};
const kept = [...Object.values(makers).map(make => make())];
hide(kept);
for (const name of Object.keys(reads)) tried("all " + name, () => reads[name](hide(kept), { k: 1 }, 40));
const order = process.argv[2] ? [process.argv[2]] : Object.keys(changes);
for (const kind of Object.keys(makers)) {
  const C = classes[kind], of = [makers[kind](), makers[kind]()], mixedIn = [of[0], new Plain()];
  for (const name of Object.keys(reads)) {
    tried(kind + " " + name, () => reads[name](hide(of), { k: 1 }, 30));
    tried(kind + " beside " + name, () => reads[name](hide(mixedIn), hide(C), 30));
  }
  for (const change of order) {
    const saved = [C.prototype, C].map(holder => [holder, Object.getOwnPropertyDescriptors(holder), Object.getPrototypeOf(holder)]);
    const changed = [makers[kind](), makers[kind]()];
    tried(kind + " " + change, () => changes[change](C, changed[0]));
    for (const name of Object.keys(reads)) {
      tried(kind + " " + change + " " + name, () => reads[name](hide(changed), { k: 1 }, 12));
      tried(kind + " " + change + " again " + name, () => reads[name](hide(of), hide(C), 12));
    }
    for (const [holder, descriptors, above] of saved) {
      for (const key of Reflect.ownKeys(holder)) if (!Object.hasOwn(descriptors, key)) delete holder[key];
      for (const key of Reflect.ownKeys(descriptors)) if (descriptors[key].configurable || descriptors[key].writable) Object.defineProperty(holder, key, descriptors[key]);
      Object.setPrototypeOf(holder, above);
    }
    for (const name of Object.keys(reads)) tried(kind + " behind " + change + " " + name, () => reads[name](hide(of), { k: 1 }, 12));
  }
}
console.log(lines.join("\n"));
console.log(counted, hash);
