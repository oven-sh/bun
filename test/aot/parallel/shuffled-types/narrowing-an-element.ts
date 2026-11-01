// An element narrowed by typeof is replaced by a call before it is used. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f16(l: (number | string)[], h: () => void): unknown { if (typeof l[0] === "number") { h(); return l[0] + 1; } return "string"; }
const l16: (number | string)[] = [1]; for (let i = 0; i < 30; i++) f16([i], () => {}); show(f16(l16, () => { l16[0] = "text"; }), f16(l16, () => {}));
export {};
