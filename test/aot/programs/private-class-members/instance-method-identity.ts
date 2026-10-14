// A private instance method is the same function object for all instances of one class evaluation and a different one for another evaluation.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    #free() { return 7; }
    #bound() { return n; }
    get #g() { return n; }
    static #count = 0;
    free() { return this.#free; }
    bound() { return this.#bound; }
    g() { return this.#g; }
    static of(o: C) { return o.#free; }
    has(o: any) { return #free in o; }
  };
}
const A = make(1), B = make(2);
const a1 = new A(), a2 = new A(), b1 = new B();
row("one object, read twice", () => a1.free() === a1.free() && a1.bound() === a1.bound());
row("two objects of one evaluation", () => a1.free() === a2.free() && a1.bound() === a2.bound());
row("two evaluations, captures nothing", () => (a1.free() as unknown) === b1.free());
row("two evaluations, captures", () => (a1.bound() as unknown) === b1.bound());
row("a mark", () => { (a1.free() as any).mark = 1; return [(a2.free() as any).mark, (b1.free() as any).mark].join(); });
row("called", () => [a1.free().call(a1), a1.bound().call(a1), b1.bound().call(b1), a1.g(), b1.g()].join());
row("through a static method", () => A.of(a1) === a1.free());
row("in a set", () => new Set<unknown>([a1.free(), a2.free(), b1.free(), a1.bound(), b1.bound()]).size);
for (let i = 0; i < 2; i++) {
  const L = class { #m() {} m() { return this.#m; } };
  row("in a loop " + i, () => { const f = new L().m(); const first = !(globalThis as any).kept; const same = (globalThis as any).kept === f; (globalThis as any).kept = f; return first + " " + same; });
}
class T { #m() {} m() { return this.#m; } }
row("at the top level", () => new T().m() === new T().m());
