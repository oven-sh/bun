// Fields and a variable declared with `!` are read before anything is stored. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Late { n!: number; s!: string; o!: { v: number }; sum(): unknown { return [this.n + 1, typeof this.s, this.o === undefined]; } }
let late!: number; function f26(): unknown { return [late, late + 1]; }
show(new Late().sum(), f26(), Object.keys(new Late()));
export {};
