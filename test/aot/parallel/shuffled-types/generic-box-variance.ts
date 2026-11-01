// A box of texts gets a number through a second name under which it is a box of texts or numbers. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Box<T> { constructor(public value: T) {} set(v: T): void { this.value = v; } }
function len(b: Box<string>): number { return b.value.length; }
const bs = new Box<string>("abc"); for (let i = 0; i < 30; i++) len(new Box("x"));
const bw: Box<string | number> = bs; bw.set(5); show(len(bs), typeof bs.value);
export {};
