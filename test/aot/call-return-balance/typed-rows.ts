let sink: number = 0;
let never: number = 0;
if (process.argv.length > 50) never = 1;
function add(a: number, b: number): number { try { if (never > 0) throw never; } catch { return -1; } return a + b; }
function optional(a: number, b?: number): number { try { if (never > 0) throw never; } catch { return -1; } return a + (b === undefined ? 1 : b); }
function defaulted(a: number, b: number = 2): number { try { if (never > 0) throw never; } catch { return -1; } return a + b; }
function rest(first: number, ...others: number[]): number { try { if (never > 0) throw never; } catch { return -1; } return first + others.length; }
function forwardsSpread(...all: [number, number]): number { try { if (never > 0) throw never; } catch { return -1; } return add(...all); }
function tail(n: number): number { try { if (never > 0) throw never; } catch { return -1; } return add(n, 1); }
function text(a: string, b: string): string { try { if (never > 0) throw never; } catch { return ""; } return a + b; }
function pair(a: number): { first: number; second: number } { try { if (never > 0) throw never; } catch { return { first: 0, second: 0 }; } return { first: a, second: a + 1 }; }
function apply1(f: (x: number) => number, x: number): number { try { if (never > 0) throw never; } catch { return -1; } return f(x); }
function makeAdder(n: number): (x: number) => number { try { if (never > 0) throw never; } catch { return x => x; } return x => x + n; }
function generic<T>(value: T): T { try { if (never > 0) throw never; } catch { return value; } return value; }
function union(value: number | string): number { try { if (never > 0) throw never; } catch { return -1; } return typeof value === "number" ? value : value.length; }
interface Shape { area(): number; }
class Square implements Shape { constructor(public side: number) {} area(): number { try { if (never > 0) throw never; } catch { return -1; } return this.side * this.side; } get twice(): number { try { if (never > 0) throw never; } catch { return -1; } return this.side * 2; } set twice(v: number) { try { if (never > 0) throw never; } catch { return; } this.side = v / 2; } static make(side: number): Square { try { if (never > 0) throw never; } catch { return new Square(0); } return new Square(side); } }
class Circle implements Shape { constructor(public radius: number) {} area(): number { try { if (never > 0) throw never; } catch { return -1; } return 3 * this.radius * this.radius; } }
class Cube extends Square { #depth: number = 1; constructor(side: number) { super(side + 1); } area(): number { try { if (never > 0) throw never; } catch { return -1; } return super.area() * this.#deep(); } #deep(): number { try { if (never > 0) throw never; } catch { return -1; } return this.#depth; } }
const shapes: Shape[] = [new Square(1), new Circle(1), new Cube(1)];
const adder: (x: number) => number = makeAdder(2);
const boundAdd: (b: number) => number = add.bind(null, 1);
const numbers: number[] = [3, 1, 2, 5, 4];
function* counts(n: number): Generator<number, void, unknown> { for (let i = 0; i < n; i++) yield i; }
function* delegates(inner: Iterable<number>): Generator<number, void, unknown> { yield* inner; }
const kept: unknown[] = [];
function keep<T>(value: T): T { kept.push(value); return kept.pop() as T; }
function drive(generator: Generator<number, void, unknown>): number { let t = 0; for (let step = generator.next(); !step.done; step = generator.next()) t += step.value; return t; }
function driveIterator(iterator: Iterator<number, void, unknown>): number { let t = 0; for (let step = iterator.next(); !step.done; step = iterator.next()) t += step.value; return t; }
function total(values: Iterable<number>): number { let t = 0; for (const v of values) t += v; return t; }
function first(values: Iterable<number>): number { for (const v of values) return v; return -1; }
class RangeIterator { at = 0; constructor(readonly end: number) {} next(): IteratorResult<number, undefined> { return this.at < this.end ? { value: this.at++, done: false } : { value: undefined, done: true }; } }
class Range { constructor(readonly end: number) {} [Symbol.iterator](): RangeIterator { return new RangeIterator(this.end); } }
class Walk { constructor(readonly end: number) {} *[Symbol.iterator](): Generator<number, void, unknown> { for (let i = 0; i < this.end; i++) yield i; } }
function spreadLength(values: Iterable<number>): number { return [...values].length; }
function firstTwo(values: Iterable<number>): number { const [a, b] = values; return a + b; }
function finallyRuns(x: number): number { try { return add(x, 1); } finally { sink++; } }
function deep(n: number): number { return n === 0 ? 0 : 1 + deep(n - 1); }
export const typedRows: Record<string, () => number> = {
    nothing: () => 1,
    call: () => add(1, 2),
    optional: () => optional(1),
    defaulted: () => defaulted(1),
    rest: () => rest(1, 2, 3),
    spread: () => forwardsSpread(1, 2),
    tail: () => tail(1),
    text: () => text("a", "b").length,
    pair: () => pair(1).second,
    closureArgument: () => apply1(x => x + 1, 1),
    closureKept: () => adder(1),
    closureMade: () => makeAdder(1)(2),
    bound: () => boundAdd(2),
    generic: () => generic(1) + generic("a").length,
    union: () => union(1) + union("ab"),
    method: () => (shapes[0] as Square).area(),
    interface: () => { let t = 0; for (const s of shapes) t += s.area(); return t; },
    superAndPrivate: () => new Cube(1).area(),
    getter: () => (shapes[0] as Square).twice,
    setter: () => { (shapes[0] as Square).twice = 2; return 1; },
    static: () => Square.make(2).side,
    construct: () => new Circle(2).radius,
    map: () => numbers.map(x => x + 1).length,
    reduce: () => numbers.reduce(add, 0),
    sort: () => numbers.slice().sort((a, b) => a - b)[0],
    forEach: () => { let t = 0; numbers.forEach(x => { t += x; }); return t; },
    generator: () => { let t = 0; for (const v of counts(3)) t += v; return t; },
    generatorNext: () => { const g = counts(2); g.next(); return g.next().done ? 1 : 0; },
    generatorKeptDeclared: () => drive(keep(counts(3))),
    generatorKeptByName: () => driveIterator(keep(counts(3))),
    generatorKeptForOf: () => total(keep(counts(3))),
    generatorKeptLeftEarly: () => first(keep(counts(3))),
    generatorKeptDelegate: () => total(keep(delegates(keep(counts(3))))),
    generatorKeptReturn: () => { const g = keep(counts(3)); g.next(); return g.return().done ? 1 : 0; },
    generatorKeptSpread: () => spreadLength(keep(counts(3))),
    iterableClassForOf: () => total(keep(new Range(3))),
    iterableClassLeftEarly: () => first(keep(new Range(3))),
    iterableClassPattern: () => firstTwo(keep(new Range(3))),
    iterableClassSpread: () => spreadLength(keep(new Range(3))),
    iterableGeneratorMethodForOf: () => total(keep(new Walk(3))),
    iterableGeneratorMethodSpread: () => spreadLength(keep(new Walk(3))),
    finally: () => finallyRuns(1),
    deep20: () => deep(20),
};
async function resolved(x: number): Promise<number> { try { if (never > 0) throw never; } catch { return -1; } return x + 1; }
async function awaitsOne(x: number): Promise<number> { return (await resolved(x)) + 1; }
async function awaitsThree(x: number): Promise<number> { let t = 0; for (let i = 0; i < 3; i++) t += await resolved(x); return t; }
async function* asyncCounts(n: number): AsyncGenerator<number, void, unknown> { for (let i = 0; i < n; i++) yield i; }
async function forAwait(n: number): Promise<number> { let t = 0; for await (const v of asyncCounts(n)) t += v; return t; }
export const typedAsyncRows: Record<string, () => Promise<number>> = {
    asyncNothing: async () => 1,
    awaitOne: () => awaitsOne(1),
    awaitThree: () => awaitsThree(1),
    forAwait: () => forAwait(3),
    then: () => Promise.resolve(1).then((v: number) => v + 1),
};
