// Static private fields and initializers that throw: which members exist afterwards, and that methods and accessors exist from the start.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

let leaked: any;
row("the initializer between throws", () => {
  class C {
    static has() { return [#a in C, #b in C].join(); }
    static readA() { return C.#a; }
    static readB() { return C.#b; }
    static writeB() { C.#b = 2; return "stored"; }
    static #a = 1;
    static { leaked = C; }
    static boom = (() => { throw new RangeError("boom"); })();
    static #b = 1;
  }
  return C;
});
for (const door of ["has", "readA", "readB", "writeB", "has"]) row("behind the throw " + door, () => leaked[door]());
let topLeaked: any;
try {
  class T {
    static has() { return [#a in T, #b in T, #m in T].join(); }
    static readB() { return T.#b; }
    static writeB() { T.#b = 2; return "stored"; }
    static m() { return T.#m === T.#m; }
    static #m() {}
    static #a = 1;
    static { topLeaked = T; throw new RangeError("boom"); }
    static #b = 1;
  }
} catch (e) { console.log("top level: " + (e as Error).name); }
for (const door of ["has", "readB", "writeB", "has", "m"]) row("top level behind the throw " + door, () => topLeaked[door]());
class Blank { static #u: unknown; static { row("without an initializer", () => [#u in Blank, Blank.#u].join()); } }
class Chain { static #a = 1; static #b = Chain.#a + 1; static #c = Chain.#b + Chain.#a; static { row("one after the other", () => [Chain.#a, Chain.#b, Chain.#c].join()); } }
class Later {
  static peek = () => Later.#v;
  static poke = (v: number) => { Later.#v = v; };
  static first = said(Later.peek) + " " + said(() => Later.poke(3));
  static #v = 1;
  static second = said(Later.peek) + " " + said(() => Later.poke(3)) + " " + said(Later.peek);
}
console.log("a closure made early: " + Later.first + " | " + Later.second);
const rounds: string[] = [];
for (let i = 0; i < 3; i++) {
  class L {
    static has() { return #v in L; }
    static { rounds.push(String(L.has())); }
    static #v = i;
    static { rounds.push(String(L.has()) + L.#v); }
  }
}
console.log("each evaluation starts without: " + rounds.join());
class Self { static #me: unknown = said(() => Self.#me); static { row("its own initializer reads it", () => Self.#me); } }
class Methods { static { row("methods and accessors are there from the start", () => [#m in Methods, #g in Methods, #s in Methods, typeof Methods.#m, Methods.#g].join()); } static #m() {} static get #g() { return 1; } static set #s(v: number) {} }
