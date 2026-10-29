// The prototype of a class that extends Array is given an accessor, or a property that cannot be written, under an index: stores to the instances that come to that index go by it.
declare const console: { log(...values: unknown[]): void };
const trace: string[] = [];
class Before<T> extends Array<T> {}
class After<T> extends Array<T> {}
class ReadOnly<T> extends Array<T> {}
function storeAt(a: string[], i: number, x: string): void { a[i] = x; }
function storeAtAny(a: any, i: any, x: any): void { a[i] = x; }
function pushTo(a: string[], x: string): number { return a.push(x); }
function pushToAny(a: any, x: any): number { return a.push(x); }
function readAt(a: string[], i: number): string | undefined { return a[i]; }
function readAtAny(a: any, i: any): unknown { return a[i]; }
function walk(a: string[]): string { let s = ""; for (let i = 0; i < a.length; i++) s += a[i] + ";"; return s; }
function walkOf(a: string[]): string { let s = ""; for (const x of a) s += x + ";"; return s; }
function tell(name: string, f: () => unknown): void {
    trace.length = 0;
    let line: string;
    try { line = JSON.stringify(f(), (_, v) => (v === undefined ? "<undefined>" : v)) ?? "undefined"; } catch (e) { line = "throws " + (e as Error).constructor.name; }
    console.log(name + ": " + line + " {" + trace.join(",") + "}");
}
function three<L extends string[]>(a: L): L { a.push("a"); a.push("b"); a.push("c"); return a; }
const early = three(new Before<string>());
for (let round = 0; round < 3; round++) { storeAt(three(new Before<string>()), 1, "warm"); storeAtAny(three(new Before<string>()), 1, "warm"); pushTo(three(new Before<string>()), "warm"); pushToAny(three(new After<string>()), "warm"); walk(three(new After<string>())); }
Object.defineProperty(Before.prototype, "3", { get() { trace.push("getter"); return "got"; }, set(v: string) { trace.push("setter " + v); }, configurable: true });
Object.defineProperty(After.prototype, "3", { get() { trace.push("getter"); return "got"; }, set(v: string) { trace.push("setter " + v); }, configurable: true });
Object.defineProperty(ReadOnly.prototype, "3", { value: "fixed", writable: false, configurable: true });
const makers: Record<string, () => string[]> = {
    "made before": () => early.slice(0, 3) as string[],
    "the one made before": () => { early.length = 3; return early; },
    before: () => three(new Before<string>()),
    after: () => three(new After<string>()),
    "read only": () => three(new ReadOnly<string>()),
    array: () => three([]),
};
for (const [name, make] of Object.entries(makers)) {
    tell(name + ": store at the length", () => { const a = make(); storeAt(a, 3, "x"); return [a.length, Object.keys(a)]; });
    tell(name + ": store at the length, any", () => { const a = make(); storeAtAny(a, 3, "x"); return [a.length, Object.keys(a)]; });
    tell(name + ": push", () => { const a = make(); return [pushTo(a, "x"), a.length, Object.keys(a)]; });
    tell(name + ": push, any", () => { const a = make(); return [pushToAny(a, "x"), a.length, Object.keys(a)]; });
    tell(name + ": store within", () => { const a = make(); storeAt(a, 1, "x"); return a; });
    tell(name + ": store beyond", () => { const a = make(); storeAt(a, 5, "x"); return [a.length, Object.keys(a)]; });
    tell(name + ": read any beyond the length", () => readAtAny(make(), 3));
    tell(name + ": a hole, any", () => { const a = make(); a.length = 5; return [readAtAny(a, 3), readAtAny(a, 4)]; });
    tell(name + ": walk", () => walk(make()));
    tell(name + ": walk of", () => walkOf(make()));
}
