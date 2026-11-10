const say = (x: number): string => Object.is(x, -0) ? "-0" : String(x);
const fine: number[] = [0.5, -0.5, 1.5, -1.5, 2.5, -2.5, -0, 0, 0.49999999999999994, -0.49999999999999994, 5e-324, -5e-324, 2147483647.5, -2147483648.5, 2147483648, -2147483649, 4294967295, 4294967296, 4503599627370495.5, 9007199254740991, 9007199254740992, 1e21, -1e21];
const wild: number[] = [NaN, 0.5, Infinity, -Infinity, -0, NaN, 1.5, -1.5, 2.5, 0, -2.5, 1e21, NaN, 5e-324, 2147483648, -2147483649, 9007199254740992, -Infinity, 0.49999999999999994, -0.5, Infinity, NaN];
const whole: number[] = [0, 1, -1, 7, -7, 100, -100, 65536, -65536, 2147483647, -2147483648, 1073741824, 3, 255, -255, 46341, -46341];
function byAbs(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.abs(x); } }
function byFloor(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.floor(x); } }
function byCeil(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.ceil(x); } }
function byTrunc(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.trunc(x); } }
function byRound(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.round(x); } }
function byFround(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.fround(x); } }
function bySqrt(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.sqrt(x); } }
function byMin(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.min(x, k); } }
function byMax(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.max(x, k); } }
function byImul(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.imul(x, k); } }
function byClz32(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.clz32(x); } }
function bySign(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Math.sign(x); } }
function byIsNaN(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = isNaN(x) ? 1 : 0; } }
function byIsFinite(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = isFinite(x) ? 1 : 0; } }
function byNumberIsNaN(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Number.isNaN(x) ? 1 : 0; } }
function byNumberIsFinite(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Number.isFinite(x) ? 1 : 0; } }
function byNumberIsInteger(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Number.isInteger(x) ? 1 : 0; } }
function byNumberIsSafeInteger(a: Float64Array, out: Float64Array, k: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]!; out[i] = Number.isSafeInteger(x) ? 1 : 0; } }
const all: [string, (a: Float64Array, out: Float64Array, k: number) => void][] = [["abs", byAbs], ["floor", byFloor], ["ceil", byCeil], ["trunc", byTrunc], ["round", byRound], ["fround", byFround], ["sqrt", bySqrt], ["min", byMin], ["max", byMax], ["imul", byImul], ["clz32", byClz32], ["sign", bySign], ["isNaN", byIsNaN], ["isFinite", byIsFinite], ["numberIsNaN", byNumberIsNaN], ["numberIsFinite", byNumberIsFinite], ["numberIsInteger", byNumberIsInteger], ["numberIsSafeInteger", byNumberIsSafeInteger]];
for (const [name, store] of all) for (const [set, base] of [["fine", fine], ["wild", wild], ["whole", whole]] as [string, number[]][]) for (const n of [0, 1, 7, 8, 9, 16, 17]) for (const k of [3, -0]) {
  const a = new Float64Array(base.slice(0, n)), out = new Float64Array(n).fill(-7.5);
  store(a, out, k);
  console.log(name, set, n, say(k), Array.from(out, say).join(" "));
}
// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 18
