// A read that follows a store to the same field returns the stored value, also when two variables refer to the same object.
declare const console: any;
const log: any[] = [];
interface P { x: number; y: number | undefined; o?: number; q: P | undefined }
function make(x: number): P { return { x, y: undefined, q: undefined }; }
const hide = (v: unknown): any => v;
let moduleVariable = 0;
function changesModule(): number { moduleVariable += 10; return 1; }
function twoNames(a: P, b: P): number { a.x = 1; b.x = 2; return a.x * 10 + b.x; }
function callBetween(a: P, f: (p: P) => void): number { a.x = 1; f(a); return a.x; }
function throughAny(a: P): number { a.x = 1; hide(a).x = 5; return a.x; }
function otherField(a: P): number { a.x = 1; a.y = 2; return a.x * 10 + (a.y ?? 0); }
function deleted(a: P): string { a.o = 1; delete a.o; return String(a.o) + ("o" in a); }
function frozen(a: P): string { Object.freeze(a); try { a.x = 9; return "stored " + a.x; } catch (e: any) { return "threw " + e.constructor.name + " " + a.x; } }
function wrongUnderHandler(a: P, v: any): string { a.x = 1; try { a.x = v; return "stored " + a.x; } catch (e: any) { return "threw " + e.constructor.name + " " + a.x; } }
function oneWay(a: P, c: boolean): number { if (c) a.x = 7; return a.x; }
function bothWays(a: P, c: boolean): number { if (c) a.x = 7; else a.x = 8; return a.x; }
function inLoop(a: P, n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += a.x; a.x = i; s += a.x; } return s; }
function loopCarried(a: P, b: P, n: number): number { a.x = 100; let s = 0; for (let i = 0; i < n; i++) { s += a.x; b.x = i; } return s; }
function numbers(a: P): string { const out: any[] = []; for (const v of [0, -0, 1.5, NaN, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, Infinity]) { a.x = v; out.push(Object.is(a.x, v)); a.y = v; out.push(Object.is(a.y, v)); } return out.join(); }
function chain(a: P): number { a.q = make(3); a.q.x = 4; a.q.q = a; a.q.q.x = 5; return a.x * 10 + a.q.x; }
function environment(): string { let n = 0; const bump = () => { n += 5; }; n = 1; bump(); const first = n; n = 2; const second = n; bump(); return first + " " + second + " " + n; }
function module(): string { moduleVariable = 1; const a = moduleVariable; changesModule(); const b = moduleVariable; moduleVariable = 3; return a + " " + b + " " + moduleVariable; }
function nilReceiver(a: P | undefined): string { try { a!.x = 1; return "stored " + a!.x; } catch (e: any) { return "threw " + e.constructor.name; } }
function attempt(name: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
for (let round = 0; round < 2; round++) {
    const p = make(0), r = make(0);
    attempt("twoNames, two", () => twoNames(p, r)); attempt("twoNames, one", () => twoNames(p, p)); attempt("callBetween", () => callBetween(p, x => { x.x = 42; })); attempt("callBetween, nothing", () => callBetween(p, () => { }));
    attempt("throughAny", () => throughAny(p)); attempt("otherField", () => otherField(p)); attempt("deleted", () => deleted(p)); attempt("frozen", () => frozen(make(3))); attempt("wrongUnderHandler, right", () => wrongUnderHandler(p, 6));
    attempt("oneWay yes", () => oneWay(make(1), true)); attempt("oneWay no", () => oneWay(make(1), false)); attempt("bothWays", () => bothWays(p, true) * 10 + bothWays(p, false)); attempt("inLoop", () => inLoop(make(50), 4));
    attempt("loopCarried, two", () => loopCarried(p, r, 3)); attempt("loopCarried, one", () => loopCarried(p, p, 3)); attempt("numbers", () => numbers(p)); attempt("chain", () => chain(make(1))); attempt("environment", environment); attempt("module", module);
    attempt("nilReceiver", () => nilReceiver(hide(undefined))); attempt("nilReceiver, there", () => nilReceiver(p));
}
console.log(log.join("\n"));
export {};
