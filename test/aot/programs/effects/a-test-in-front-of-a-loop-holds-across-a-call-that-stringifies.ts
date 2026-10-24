// `iterated` tests the storage of its array once, in front of the loop, because the call of `show` in the loop runs no code that could change the array: JSON.stringify of a string,
// a number, a plain object or an array of them runs none. The serializer that takes the place of JSON.stringify in `show` may not say more than the call did: it used to read
// "the rest of an array after unknown code" element by element, by name, and the test in front of the loop was then refused by the verifier: the program did not build.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value + " " + JSON.stringify(value); }
function attempt(label: string, ...runs: (() => unknown)[]): void {
  console.log(label + ": " + runs.map(run => { try { return show(run()); } catch (error) { return "threw " + (error as Error).name; } }).join(" | "));
}
type NoUndefined<T> = T extends undefined ? never : T;
interface Holder<Output = unknown> { _output: Output }
type Output<T> = T extends { _output: any } ? T["_output"] : never;
type Bound<T> = NoUndefined<Output<T>> | number[] | null;
const text: Holder<string> = { _output: "" };
const point: Holder<{ x: number }> = { _output: { x: 1 } };
function iterated<T extends Holder, V extends Bound<T>>(inner: T, list: V[]): string { let out = ""; for (const each of list) out += show(each); return out; }
function local<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { const copy = value; return show(copy); }
function* yielded<T extends Holder, V extends Bound<T>>(inner: T, value: V): Generator<unknown> { yield value; }
class Keeper<T extends Holder, V extends Bound<T>> { constructor(public inner: T, public value: V) {} text(): string { return show(this.value); } get held(): unknown { return this.value; } }
attempt("iterated", () => iterated(text, ["a", "b"]), () => iterated(point, [{ x: 2 }, { x: 3 }]));
attempt("yielded", () => [...yielded(text, "a")], () => [...yielded(point, { x: 2 })]);
attempt("local", () => local(text, "a"), () => new Keeper(point, { x: 4 }).text());
