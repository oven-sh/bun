// A tuple in a field is popped and pushed: its declared length is a literal. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Pair { at: [number, number] = [0, 0]; width(): number { return this.at[1] - this.at[0]; } count(): number { return this.at.length; } }
const p5 = new Pair(); for (let i = 0; i < 30; i++) { new Pair().width(); new Pair().count(); }
p5.at.pop(); show(p5.width(), p5.count()); p5.at.push(4, 5, 6); show(p5.width(), p5.count());
export {};
