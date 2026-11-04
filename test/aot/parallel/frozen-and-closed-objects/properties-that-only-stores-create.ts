// The classes declare nothing: every property of their objects is created by a store somewhere else, as in `class SymbolLinks {}` of the TypeScript compiler.
class Links { declare brand: unknown; }
interface Links { a?: number; b?: string; c?: object; d?: number; e?: unknown; f?: unknown; g?: unknown; h?: unknown; i?: unknown; j?: unknown; k?: unknown; l?: unknown }
function Old(this: any) { this.first = 1; }
interface OldObject { first: number; a?: number; b?: unknown; c?: unknown; d?: unknown }
let log = "";
function show(o: object): string { const own = Object.keys(o).join(); return own + "|" + JSON.stringify(o) + "|" + ("b" in o) + ("d" in o) + Object.isFrozen(o) + Object.isExtensible(o) + log; }
function attempt(run: () => object): string { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + log; } }

function undefinedFirst(l: Links): Links { l.b = undefined; l.a = undefined; l.b = "x"; return l; }
function undefinedOnly(l: Links): Links { l.c = undefined; l.d = undefined; return l; }
function some(l: Links, k: number): Links { if (k & 1) l.a = 1; l.b = undefined; l.c = k & 2 ? { n: k } : undefined; l.d = k; return l; }
function backwards(l: Links): Links { l.l = 12; l.k = 11; l.j = 10; l.i = 9; l.h = 8; l.g = 7; l.f = 6; l.e = 5; l.d = 4; l.c = {}; l.b = "2"; l.a = 1; return l; }
function forwards(l: Links): Links { l.a = 1; l.b = "2"; l.c = {}; l.d = 4; l.e = 5; l.f = 6; l.g = 7; l.h = 8; l.i = 9; l.j = 10; l.k = 11; l.l = 12; return l; }
function scattered(l: Links): Links { l.f = 6; l.a = 1; l.l = undefined; l.c = {}; l.k = 11; l.b = undefined; l.l = 12; l.g = undefined; return l; }
function twice(l: Links): Links { l.a = 1; l.a = 2; l.b = undefined; l.b = undefined; l.d = undefined; l.d = 3; l.d = undefined; return l; }
function deletedBetween(l: Links): Links { l.a = 1; l.b = undefined; l.d = 2; delete l.b; delete l.a; l.b = "again"; l.a = undefined; return l; }
function around(l: Links, hook: (o: object) => void): Links { l.a = 1; l.b = undefined; hook(l); l.d = 2; l.b = "late"; l.e = undefined; return l; }
function old(o: OldObject, k: number): OldObject { o.b = undefined; if (k & 1) o.a = 1; o.c = k; o.d = undefined; return o; }
function made(k: number): Links { const l = new Links(); l.d = k; if (k & 1) l.b = undefined; l.a = 1; return l; }
function madeAndCopied(k: number): object { const l = new Links(); l.d = k; if (k & 1) l.b = undefined; return { ...l }; }
function read(l: Links): string { return [l.a, l.b, l.c === undefined, l.d, l.e, l.l].join(); }

for (let i = 0; i < 40; i++) { undefinedFirst(new Links()); undefinedOnly(new Links()); some(new Links(), i); backwards(new Links()); forwards(new Links()); scattered(new Links()); twice(new Links()); deletedBetween(new Links()); around(new Links(), () => { }); old(new (Old as any)(), i); made(i); madeAndCopied(i); }

console.log(attempt(() => undefinedFirst(new Links())));
console.log(attempt(() => undefinedOnly(new Links())));
for (let k = 0; k < 4; k++) console.log(attempt(() => some(new Links(), k)), attempt(() => old(new (Old as any)(), k)), attempt(() => made(k)), attempt(() => madeAndCopied(k)));
console.log(attempt(() => backwards(new Links())));
console.log(attempt(() => forwards(new Links())));
console.log(attempt(() => scattered(new Links())));
console.log(attempt(() => twice(new Links())));
console.log(attempt(() => deletedBetween(new Links())));
console.log(attempt(() => forwards(backwards(new Links()))), attempt(() => scattered(undefinedOnly(new Links()))));
console.log(read(scattered(new Links())), read(undefinedOnly(new Links())), read(new Links()));

const hooks: ((o: object) => void)[] = [
  o => { Object.freeze(o); }, o => { Object.seal(o); }, o => { Object.preventExtensions(o); },
  o => { Object.defineProperty(o, "d", { set(v) { log += " own d=" + v; }, configurable: true, enumerable: true }); },
  o => { Object.defineProperty(o, "b", { value: "fixed", writable: false, enumerable: true, configurable: true }); },
  o => { Object.defineProperty(o, "e", { value: 1, writable: false }); },
  o => { Object.setPrototypeOf(o, { set d(v: unknown) { log += " above d=" + v; }, set e(v: unknown) { log += " above e=" + v; } }); },
  o => { Object.setPrototypeOf(o, null); }, o => { delete (o as Links).b; }, o => { (o as any).other = 1; }, o => { (o as Links).d = 9; (o as Links).e = 8; },
];
for (const hook of hooks) console.log(attempt(() => around(new Links(), hook)));
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  console.log(attempt(() => undefinedOnly(close(new Links()))), attempt(() => undefinedFirst(close(undefinedOnly(new Links())))), attempt(() => twice(close(forwards(new Links())))), attempt(() => undefinedOnly(close(undefinedOnly(new Links())))));
}
for (const descriptor of [{ set(v: unknown) { log += " set " + v; }, configurable: true }, { get() { return 7; }, configurable: true }, { value: 8, writable: false, configurable: true }, { value: 9, writable: true, configurable: true }]) {
  for (const name of ["b", "d"]) {
    Object.defineProperty(Links.prototype, name, descriptor); Object.defineProperty(Old.prototype, name, descriptor);
    console.log(name, attempt(() => undefinedFirst(new Links())), attempt(() => undefinedOnly(new Links())), attempt(() => some(new Links(), 3)), attempt(() => old(new (Old as any)(), 1)), attempt(() => made(1)));
    delete (Links.prototype as any)[name]; delete Old.prototype[name];
    console.log(name, attempt(() => undefinedFirst(new Links())), attempt(() => some(new Links(), 3)), attempt(() => old(new (Old as any)(), 1)), attempt(() => made(1)));
  }
}
