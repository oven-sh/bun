// A wrongly typed argument to an async function rejects the returned promise and never throws to the caller: calls from code that does not know the function's types.
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
// A value of unknown type.
const table: any[] = [takesArray, arrow, k.m, K.s, k.f, literal.m, awaitsFirst, takesTwo, generator, asyncGenerator, plain, plainReturnsPromise];
const receivers: any[] = [undefined, undefined, k, K, undefined, literal, undefined, undefined, undefined, undefined, undefined, undefined];
const names = ["a function", "an arrow", "a method", "a static method", "an arrow in a field", "a literal's method", "one that awaits first", "one of two parameters", "A GENERATOR", "AN ASYNC GENERATOR", "A PLAIN FUNCTION", "A PLAIN FUNCTION THAT RETURNS A PROMISE"];
for (let i = 0; i < table.length; i++) row("a value: " + names[i], () => table[i].call(receivers[i], 5));
// `this`.
row("this: a foreign object", () => k.m.call({ v: 100 } as any, [1]));
row("this: a foreign object, no parameters", () => k.noParameters.call({ v: 100 } as any));
row("this: a number", () => k.m.call(5 as any, [1]));
row("this: bound by the engine to a foreign object", () => k.m.bind({ v: 100 } as any)([1]));
row("this: and the parameter", () => k.m.call(5 as any, 5 as any));
// Bound.
row("bound: to its object, the parameter refused", () => (k.m.bind(k) as any)(5));
row("bound: with one argument, the other refused", () => (takesTwo.bind(null, 1) as any)(2));
row("bound: the bound argument itself refused", () => (takesTwo as any).bind(null, "a")("b"));
// call, apply, Reflect.apply, callbacks of built-ins.
row("Reflect.apply", () => Reflect.apply(takesArray as any, null, [5]));
// A variable that holds one function.
let held: any = takesArray; function callsHeld(x: unknown): unknown { return held(x); }
// Handlers at the call.
// Not async functions.
// The rule of the language itself, the same in both runtimes: an async function rejects; a generator, an async generator and a plain function throw to the caller.
for (const [n, f] of [["an async function", asyncPattern], ["A GENERATOR", generatorPattern], ["AN ASYNC GENERATOR", asyncGeneratorPattern], ["A PLAIN FUNCTION", plainPattern]] as Array<[string, any]>) row("a pattern, through a value: " + n, () => f(5));
let caught = "";
table[0](5).catch((e: any) => { caught += e.constructor.name; });
console.log("behind what is refused, with `.catch` and no `try`: still here");
Promise.all(lines).then(all => { for (const line of all) console.log(line); console.log("caught by `.catch`: " + caught); console.log("the end"); });
export {};
