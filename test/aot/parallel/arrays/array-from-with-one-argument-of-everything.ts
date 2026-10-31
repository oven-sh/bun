// Array.from(x) with one argument, of everything x may be: lists with holes, lists whose iterator is replaced, lists below a class, sets, maps, strings, arguments, iterators, array-likes, and what it refuses.
const out: string[] = [];
const show = (label: string, make: () => unknown) => { try { const made = make() as unknown[]; out.push(`${label}: ${JSON.stringify(made)} ${Array.isArray(made)} ${Object.getPrototypeOf(made) === Array.prototype}`); } catch (e) { out.push(`${label}: ${(e as Error).constructor.name} ${(e as Error).message}`); } };
function copy<T>(x: Iterable<T> | ArrayLike<T>): T[] { return Array.from(x); }
function returned(x: number[]): number[] { return Array.from(x); }
function any(x: any): any { return Array.from(x); }
show("numbers", () => copy([1, 2, 3])); show("fractions", () => copy([0.5, 1.5])); show("none", () => copy([]));
show("holes", () => copy([1, , 3] as number[])); show("objects", () => copy([{ a: 1 }, "b", null, undefined]));
const source = [1, 2]; const made = copy(source); made.push(3); show("is a copy", () => [source, made, source === made]);
show("returned", () => returned([4, 5]));
class Stack extends Array<number> { extra = 1; }
const stack = new Stack(); stack.push(7, 8); show("below a class", () => copy(stack));
let reads = 0;
const counted = [1, 2, 3]; Object.defineProperty(counted, Symbol.iterator, { get() { reads++; return function* () { yield 9; yield 8; }; } });
show("own iterator", () => copy(counted)); show("reads of it", () => [reads]);
const noIterator = [1, 2]; Object.defineProperty(noIterator, Symbol.iterator, { value: undefined }); show("no iterator: array-like", () => copy(noIterator));
const notCallable = [1, 2]; Object.defineProperty(notCallable, Symbol.iterator, { value: 3 }); show("iterator not callable", () => any(notCallable));
const throwing = [1]; Object.defineProperty(throwing, Symbol.iterator, { value() { throw new RangeError("from the iterator"); } }); show("iterator throws", () => copy(throwing));
const closes: string[] = []; const stops = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { closes.push("closed"); return {}; } }; } }; show("set behind a generator", () => copy(new Set([1, 1, 2])));
show("map", () => copy(new Map([[1, "a"]]))); show("text", () => copy("añ😀")); show("generator", () => copy((function* () { yield 1; })()));
show("array-like", () => any({ length: 2, 0: "a", 1: "b" })); show("written length", () => any({ length: 2 })); show("typed array", () => copy(new Uint8Array([1, 2])));
function args(..._: number[]) { return Array.from(arguments); } show("arguments", () => args(1, 2));
show("number", () => any(5)); show("null", () => any(null)); show("undefined", () => any(undefined)); show("object", () => any({}));
show("spread of proxy", () => any(new Proxy([1, 2], {})));
const elements = [1, 2, 3]; const grows = { [Symbol.iterator]: elements[Symbol.iterator].bind(elements) }; show("bound", () => copy(grows as Iterable<number>));
let sum = 0; for (let i = 0; i < 100000; i++) sum += copy([i & 3, 2])[0]! + returned([1])[0]!; show("sum", () => [sum]);
console.log(out.join("\n"));
