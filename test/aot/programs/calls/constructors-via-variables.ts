// `new C(..)` where C comes out of a table: classes of the engine, bound functions, functions that ask new.target, classes of the program, and what is no constructor.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
type Constructor = new (...given: any[]) => any;
function make(C: any, ...given: any[]): any {
    switch (given.length) {
    case 0: return new C();
    case 1: return new C(given[0]);
    case 2: return new C(given[0], given[1]);
    case 3: return new C(given[0], given[1], given[2]);
    case 7: return new C(given[0], given[1], given[2], given[3], given[4], given[5], given[6]);
    default: return new C(...given);
    }
}
function attempt(label: string, run: () => unknown): void {
    try { say(label, run()); } catch (error) { say(label, "threw " + (error as Error).constructor.name); }
}
function many(run: () => unknown): unknown { let last: unknown; for (let i = 0; i < 200; i++) last = run(); return last; }

const engine: Record<string, any> = { Date, Map, Set, WeakMap, RegExp, Error, TypeError, RangeError, Array, Object, Promise, ArrayBuffer, Uint8Array, Float64Array, DataView, Boolean, Number, String, Function };
say("a date of seven numbers", many(() => make(engine.Date, 2020, 1, 2, 3, 4, 5, 6).getMilliseconds()));
say("a map of pairs", many(() => make(engine.Map, [[1, "a"], [2, "b"]]).get(2)));
say("a set", many(() => make(engine.Set, [1, 2, 2, 3]).size));
say("a regular expression", many(() => make(engine.RegExp, "a+", "g").flags + make(engine.RegExp, "a+").source));
say("an error", many(() => { const error = make(engine.Error, "oh", { cause: 7 }); return error.message + " " + error.cause + " " + (error instanceof Error); }));
say("a type error", many(() => { const error = make(engine.TypeError, "no"); return error.name + " " + (error instanceof TypeError) + " " + (error instanceof Error); }));
say("arrays", many(() => make(engine.Array, 3).length + " " + make(engine.Array, 1, 2, 3).join() + " " + make(engine.Array).length));
say("an object", many(() => typeof make(engine.Object) + " " + make(engine.Object, 5).valueOf()));
say("wrappers", many(() => typeof make(engine.Boolean, false) + " " + (make(engine.Number, "12") + 1) + " " + make(engine.String, 34).length));
say("bytes", many(() => make(engine.Uint8Array, make(engine.ArrayBuffer, 8), 2, 4).length + " " + make(engine.Float64Array, [1.5, 2.5])[1] + " " + make(engine.DataView, make(engine.ArrayBuffer, 4)).byteLength));
say("a function from text is refused or made", (() => { try { return typeof make(engine.Function, "return 1"); } catch (error) { return "function"; } })());
attempt("an array of a negative length", () => make(engine.Array, -1));
attempt("a buffer that is too long", () => make(engine.ArrayBuffer, -5));
attempt("a view without a buffer", () => make(engine.DataView));
attempt("a promise without an executor", () => make(engine.Promise));
attempt("a bad pattern", () => make(engine.RegExp, "("));
let settled = "";
make(engine.Promise, (resolve: (value: string) => void) => resolve("resolved")).then((value: string) => { settled = value; });

attempt("Symbol", () => make(Symbol));
attempt("BigInt", () => make(BigInt, 1));
attempt("Math.max", () => make(Math.max, 1, 2));
attempt("an arrow function", () => make(() => 1));
attempt("a method", () => make({ method() { return 1; } }.method));
attempt("an async function", () => make(async function () {}));
attempt("undefined", () => make(undefined));
attempt("a number", () => make(5));
attempt("a plain object", () => make({}));
attempt("parseInt", () => make(parseInt, "1"));

function Point(this: any, x: number, y: number): void { this.x = x; this.y = y; }
const BoundPoint = (Point as any).bind(null, 1);
say("a bound function", many(() => { const point = make(BoundPoint, 2); return point.x + "," + point.y + " " + (point instanceof (Point as any)) + " " + (point instanceof BoundPoint); }));
const BoundDate = (Date as any).bind(null, 2021, 5);
say("a bound class of the engine", many(() => make(BoundDate, 6).getDate() + " " + (make(BoundDate) instanceof Date)));
attempt("a bound arrow function", () => make((() => 1).bind(null)));
attempt("a bound Math.max", () => make((Math.max as any).bind(null, 1)));

function Asks(this: any, value: number): any { if (!new.target) return new (Asks as any)(value + 100); this.value = value; this.by = new.target === Asks ? "itself" : "another"; }
say("a function that asks new.target, with new", many(() => { const made = make(Asks, 1); return made.value + " " + made.by; }));
say("the same without", many(() => { const made = (Asks as any)(1); return made.value + " " + made.by; }));
say("in turn", many(() => make(Asks, 2).value + (Asks as any)(2).value + make(Asks, 3).value));
class Heir extends (Asks as any) { constructor() { super(9); } }
say("through a class that extends it", many(() => { const made = make(Heir); return made.value + " " + made.by + " " + (made instanceof Heir); }));
say("by Reflect.construct", many(() => { const made: any = Reflect.construct(Asks as any, [4], Point as any); return made.value + " " + made.by + " " + (made instanceof (Point as any)); }));
function AsksAndThrows(this: any, fail: boolean): void { if (fail) throw new RangeError("asked to"); this.target = new.target !== undefined; }
attempt("it throws", () => make(AsksAndThrows, true));
say("and is called plainly afterwards", (() => { const holder: any = {}; AsksAndThrows.call(holder, false); return holder.target; })());

class Shape { constructor(public sides: number, public name: string = "shape") {} describe(): string { return this.name + this.sides; } }
class Square extends Shape { constructor(name?: string) { super(4, name); } }
class Listed extends Array<number> { total(): number { let sum = 0; for (const each of this) sum += each; return sum; } }
class Failure extends Error { constructor(message: string, public code: number) { super(message); this.name = "Failure"; } }
const own: any[] = [Shape, Square, Listed, Failure];
say("classes of the program", many(() => make(own[0], 3).describe() + " " + make(own[1], "sq").describe() + " " + make(own[1]).describe()));
say("one that extends Array", many(() => { const list = make(own[2], 1, 2, 3); return list.total() + " " + list.length + " " + Array.isArray(list) + " " + (list instanceof Listed); }));
say("one that extends Error", many(() => { const failure = make(own[3], "bad", 3); return failure.name + " " + failure.message + " " + failure.code + " " + (failure instanceof Error); }));
attempt("a class called without new", () => own[0](3));
const handler = { construct(target: any, given: any[]) { return { trapped: given.length, of: target.name }; } };
say("a proxy with a trap", many(() => { const made = make(new Proxy(Shape, handler), 1, 2); return made.trapped + " " + made.of; }));
say("a proxy without", many(() => make(new Proxy(Shape, {}), 5).describe()));
say("many arguments", many(() => make(engine.Array, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12).length));
function deep(depth: number): number { return depth === 0 ? make(engine.Map).size : deep(depth - 1) + 1; }
say("far down the stack", deep(2000));
function forever(): number { return make(engine.Set).size + forever() + 1; }
attempt("until the stack ends", forever);
say("and after that", make(engine.Set, [1]).size);
function foreverAsking(): number { return make(Asks, 1).value + foreverAsking() + 1; }
for (let round = 0; round < 3; round++) {
    attempt("the function that asks new.target, until the stack ends", foreverAsking);
    say("called plainly after that", (Asks as any)(5).value + " " + make(Asks, 6).value);
}
Promise.resolve().then(() => { say("the promise", settled); console.log(lines.join("\n")); });
