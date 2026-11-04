// `(total + a * b) | 0`: numbers that lie boxed, in a variable of the module and in a list that has left: whatever is asked of them in front, the answer is the language's
export let total = 0;
const values: number[] = [0, -0, 1, -1, 3, 46341, -46341, 65536, 2147483647, -2147483648, 2147483648, 4294967296, 9007199254740991, 0.5, -0.5, 1e300, NaN, Infinity, -Infinity];
(globalThis as any).kept = values;
const out: string[] = [];
function spell(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
for (let t = 0; t < values.length; t++) {
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      total = values[t];
      const a = values[i], b = values[j];
      total = (total + a * b) | 0;
      out.push(spell(total));
    }
  }
}
let sum = 0;
for (const line of out) for (let k = 0; k < line.length; k++) sum = (sum * 31 + line.charCodeAt(k)) | 0;
console.log(out.length, sum, out.slice(0, 8).join(" "), out.slice(-8).join(" "));
