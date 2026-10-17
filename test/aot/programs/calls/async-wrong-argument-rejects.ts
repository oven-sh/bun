// A wrongly typed argument to an async function rejects the returned promise and never throws to the caller: direct calls.
declare const console: any;
const log: string[] = [];
function note(x: unknown): unknown { log.push(String(x)); return x; }
const lines: Array<Promise<string>> = [];
function row(n: string, f: () => unknown): void {
    let p: unknown; log.length = 0;
    try { p = f(); } catch (e: any) { lines.push(Promise.resolve(n + ": THREW TO THE CALLER " + e.constructor.name)); return; }
    const noted = log.splice(0).join(",");
    if (!(p instanceof Promise)) { lines.push(Promise.resolve(n + ": returned what is no promise: " + typeof p)); return; }
    lines.push(p.then(v => n + ": returned; fulfilled " + JSON.stringify(v) + (noted ? "; noted " + noted : ""), e => n + ": returned; rejected " + e.constructor.name + (noted ? "; noted " + noted : "")));
}
interface Point { x: number; y: number }
async function takesNumber(a: number): Promise<number> { return a + 1; }
async function takesString(a: string): Promise<number> { return a.length; }
async function takesArray(a: number[]): Promise<number> { return a.length; }
async function takesPoint(p: Point): Promise<number> { return p.x + p.y; }
async function takesTwo(a: number, b: string): Promise<string> { return a + b; }
async function takesRest(a: number, ...rest: number[]): Promise<number> { return a + rest.length; }
async function takesOptional(a: number, b?: string): Promise<string> { return a + (b ?? "none"); }
async function takesUnion(a: number | string): Promise<string> { return typeof a; }
async function takesDefault(a: unknown = note("default"), b: number[] = []): Promise<number> { return b.length; }
async function destructures({ x, y = note("y") }: { x: number; y?: unknown }, [z]: number[]): Promise<unknown[]> { return [x, y, z]; }
async function awaitsFirst(a: number[]): Promise<number> { await 0; return a.length; }
const arrow = async (a: number[]): Promise<number> => a.length;
class K { v = 10; async m(a: number[]): Promise<number> { return this.v + a.length; } static async s(a: number[]): Promise<number> { return a.length; } f = async (a: number[]): Promise<number> => this.v + a.length; async noParameters(): Promise<number> { return this.v; } }
class D extends K { async m(a: number[]): Promise<number> { return (await super.m(a)) * 2; } }
const literal = { v: 3, async m(a: number[]): Promise<number> { return this.v + a.length; } };
function* generator(a: number[]): Generator<number> { yield a.length; }
async function* asyncGenerator(a: number[]): AsyncGenerator<number> { yield a.length; }
// Where the binding of the parameters goes wrong BY THE LANGUAGE, types or no types: a pattern that is handed what cannot be taken apart.
async function asyncPattern([z]: number[]): Promise<number> { return z; }
const asyncArrowPattern = async ({ x }: Point): Promise<number> => x;
function* generatorPattern([z]: number[]): Generator<number> { yield z; }
async function* asyncGeneratorPattern([z]: number[]): AsyncGenerator<number> { yield z; }
function plainPattern([z]: number[]): number { return z; }
function plain(a: number[]): number { return a.length; }
function plainReturnsPromise(a: number[]): Promise<number> { return Promise.resolve(a.length); }
const k = new K(), d = new D();
// Named at the call.
row("named: an array wanted, a number", () => (takesArray as any)(5));
row("named: an array wanted, undefined", () => (takesArray as any)());
row("named: an array wanted, an object", () => (takesArray as any)({ length: 1 }));
row("named: an array wanted, an array", () => (takesArray as any)([1, 2]));
row("named: a number wanted, a string", () => (takesNumber as any)("s"));
row("named: a string wanted, a number", () => (takesString as any)(5));
row("named: a string wanted, undefined", () => (takesString as any)());
row("named: a record wanted, null", () => (takesPoint as any)(null));
row("named: a record wanted, a number", () => (takesPoint as any)(7));
row("named: a record wanted, one", () => (takesPoint as any)({ x: 1, y: 2 }));
row("named: the second of two", () => (takesTwo as any)(1, 2));
row("named: both of two", () => (takesTwo as any)("a", 2));
row("named: the rest", () => (takesRest as any)(1, "a", 2));
row("named: the rest, right", () => (takesRest as any)(1, 2, 3));
row("named: an optional one, absent", () => (takesOptional as any)(1));
row("named: an optional one, wrong", () => (takesOptional as any)(1, 2));
row("named: a union, neither", () => (takesUnion as any)(true));
row("named: a default ahead of what is refused: KNOWN (b)", () => (takesDefault as any)(undefined, 5));
row("named: a pattern's default ahead of what is refused: KNOWN (b)", () => (destructures as any)({ x: 1 }, 5));
row("named: behind an await it is too late to matter", () => (awaitsFirst as any)(5));
row("named: an arrow", () => (arrow as any)(5));
row("named: a method", () => (k as any).m(5));
row("named: a static method", () => (K as any).s(5));
row("named: an arrow in a field", () => (k as any).f(5));
row("named: an heir's method, refused at once", () => (d as any).m(5));
row("named: a literal's method", () => (literal as any).m(5));
// A value of unknown type.
const table: any[] = [takesArray, arrow, k.m, K.s, k.f, literal.m, awaitsFirst, takesTwo, generator, asyncGenerator, plain, plainReturnsPromise];
const receivers: any[] = [undefined, undefined, k, K, undefined, literal, undefined, undefined, undefined, undefined, undefined, undefined];
const names = ["a function", "an arrow", "a method", "a static method", "an arrow in a field", "a literal's method", "one that awaits first", "one of two parameters", "A GENERATOR", "AN ASYNC GENERATOR", "A PLAIN FUNCTION", "A PLAIN FUNCTION THAT RETURNS A PROMISE"];
for (let i = 0; i < 8; i++) row("a value, right: " + names[i], () => table[i].call(receivers[i], i === 7 ? 1 : [1, 2], "b"));
// `this`.
row("this: a method without its object", () => { const m = k.m; return (m as any)([1]); });
row("this: an heir", () => k.m.call(d, [1]));
// Bound.
row("bound: to its object, right", () => k.m.bind(k)([1]));
row("bound: with the argument, right", () => (takesTwo.bind(null, 1) as any)("b"));
// call, apply, Reflect.apply, callbacks of built-ins.
row("call", () => (takesArray as any).call(null, 5));
row("apply", () => (takesArray as any).apply(null, [5]));
row("a callback of map", () => ([5] as any[]).map(takesArray as any)[0]);
row("a callback of then", () => Promise.resolve(5).then(takesArray as any));
row("spread", () => (takesArray as any)(...[5]));
// A variable that holds one function.
let held: any = takesArray; function callsHeld(x: unknown): unknown { return held(x); }
row("a variable that holds one function", () => callsHeld(5));
row("the same, right", () => callsHeld([1]));
row("the same in a loop", () => { let refused = 0; const all: Array<Promise<unknown>> = []; for (let i = 0; i < 300; i++) all.push((callsHeld(i & 1 ? [i] : i) as Promise<unknown>).catch(() => { refused++; })); return Promise.all(all).then(() => refused); });
// Handlers at the call.
row("under a try: not caught there", () => { try { return (takesArray as any)(5); } catch { return Promise.resolve("CAUGHT AT THE CALL"); } finally { note("finally"); } });
row("awaited under a try: caught", async () => { try { return await (takesArray as any)(5); } catch (e: any) { return "caught " + e.constructor.name; } });
row("returned from an async function", async () => (takesArray as any)(5));
row("in Promise.all", () => Promise.all([takesArray([1]), (takesArray as any)(5)]));
row("in Promise.allSettled", () => Promise.allSettled([takesArray([1]), (takesArray as any)(5)]).then(r => r.map(x => x.status)));
// Not async functions.
row("named: A GENERATOR", () => (generator as any)(5));
row("named: AN ASYNC GENERATOR", () => (asyncGenerator as any)(5));
row("named: A PLAIN FUNCTION", () => (plain as any)(5));
row("named: A PLAIN FUNCTION THAT RETURNS A PROMISE", () => (plainReturnsPromise as any)(5));
// The rule of the language itself, the same in both runtimes: an async function rejects; a generator, an async generator and a plain function throw to the caller.
row("a pattern: an async function", () => (asyncPattern as any)(5));
row("a pattern: an async function, nothing handed", () => (asyncPattern as any)());
row("a pattern: an async arrow, null", () => (asyncArrowPattern as any)(null));
row("a pattern: A GENERATOR", () => (generatorPattern as any)(5));
row("a pattern: AN ASYNC GENERATOR", () => (asyncGeneratorPattern as any)(5));
row("a pattern: A PLAIN FUNCTION", () => (plainPattern as any)(5));
row("new of an async function", () => new (takesArray as any)([1]));
let caught = "";
(takesArray as any)(5).catch((e: any) => { caught = e.constructor.name; });
(k as any).m(5).catch((e: any) => { caught += "," + e.constructor.name; });
console.log("behind what is refused, with `.catch` and no `try`: still here");
Promise.all(lines).then(all => { for (const line of all) console.log(line); console.log("caught by `.catch`: " + caught); console.log("the end"); });
export {};
