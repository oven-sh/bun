// A pair is pushed to and popped: its declared length is the literal 2. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function len(t: [number, number]): number { return t.length; }
function both(t: [number, number]): number { let s = 0; for (let i = 0; i < t.length; i++) s += t[i]!; return s; }
const t1: [number, number] = [1, 2]; for (let i = 0; i < 30; i++) { len([i, i]); both([i, i]); }
t1.push(3); show(len(t1), both(t1), t1.length === 2, t1.length);
t1.pop(); t1.pop(); show(len(t1), both(t1), t1.length === 2, t1[1]);
export {};
