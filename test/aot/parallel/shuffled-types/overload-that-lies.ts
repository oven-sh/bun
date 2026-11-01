// The overloads promise the opposite of what the implementation returns. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function conv(x: number): string; function conv(x: string): number; function conv(x: number | string): number | string { return x; }
function f22(): unknown { const s = conv(1); return [s.length, s + "!"]; }
function g22(): unknown { const n = conv("a"); return [n + 1, n * 2]; }
show(f22(), g22());
export {};
