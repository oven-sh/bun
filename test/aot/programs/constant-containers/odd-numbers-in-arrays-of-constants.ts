function zeros(): number[] { return [0, -0, 0]; }
function notNumbers(): number[] { return [1.5, NaN, 2.5]; }
function onlyNaN(): number[] { return [NaN, NaN]; }
function endless(): number[] { return [Infinity, -Infinity, 1]; }
function wide(): number[] { return [2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740991, -9007199254740991, 1e21, 5e-324, 1.7976931348623157e308]; }
function whole(): number[] { return [1.0, 2.0, 3.0]; }
function longOdd(): number[] { return [0, -0, NaN, Infinity, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 2147483648, 0.1]; }
function anyNumbers(): any[] { return [1, 2, 3]; }
function numbersOrText(): (number | string)[] { return [1, 2, 3]; }
const show = (a: number[]) => a.map(v => Object.is(v, -0) ? "-0" : String(v)).join();
for (const make of [zeros, notNumbers, onlyNaN, endless, wide, whole, longOdd, anyNumbers, numbersOrText] as (() => number[])[]) {
  const a = make();
  let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i];
  console.log(make.name, show(a), sum, a.includes(NaN), a.indexOf(NaN), a.indexOf(0), a.includes(-0), Math.max(...a), Math.min(...a), JSON.stringify(a), show(a.slice().sort()), show(Array.from(new Float64Array(a))), show(Array.from(new Int32Array(a))));
  const b = make(); b[0] = 0.5; console.log(make.name, show(b), show(make()));
}
const t = numbersOrText(); t.push("x"); console.log(t.join(), numbersOrText().join());
