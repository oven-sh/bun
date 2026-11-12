// Negations, magnitudes and square roots of views, lists and integers: -0, NaN, infinities, negative numbers, subnormal ones, lengths around the width of a vector.
type Views = Float32Array | Float64Array;
function negated64(a: Float64Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = -a[i]; }
function negated32(a: Float32Array, o: Float32Array) { for (let i = 0; i < a.length; i++) o[i] = -a[i]; }
function magnitudes64(a: Float64Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = Math.abs(a[i]); }
function magnitudes32(a: Float32Array, o: Float32Array) { for (let i = 0; i < a.length; i++) o[i] = Math.abs(a[i] * 2 - 1); }
function roots64(a: Float64Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = Math.sqrt(a[i]); }
function roots32(a: Float32Array, o: Float32Array) { for (let i = 0; i < a.length; i++) o[i] = Math.sqrt(a[i]); }
function lengths(x: Float64Array, y: Float64Array, o: Float64Array) { for (let i = 0; i < x.length; i++) o[i] = Math.sqrt(x[i] * x[i] + y[i] * y[i]); }
function ofLists(a: number[], o: number[]) { for (let i = 0; i < a.length; i++) o[i] = -a[i]; }
function ofListsAgain(a: number[], o: number[]) { for (let i = 0; i < a.length; i++) o[i] = Math.sqrt(Math.abs(a[i])) - -a[i]; }
function ofIntegers(a: Int32Array, o: Float64Array) { for (let i = 0; i < a.length; i++) o[i] = -a[i]; for (let i = 1; i < a.length; i++) o[i] = o[i] * 0.5 + Math.sqrt(a[i]) + Math.abs(a[i]); }
const special = [0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 1e300, -1e300, 5e-324, -5e-324, 2, 4, 9, 2 ** 52, -(2 ** 31)];
const show = (v: ArrayLike<number>) => { let s = v.length + ":"; for (let i = 0; i < v.length; i++) if (i < 18 || i > v.length - 3) s += (i in v ? (Object.is(v[i], -0) ? "-0" : String(v[i])) : "_") + " "; return s; };
for (const n of [0, 1, 7, 8, 15, 16, 17, 18, 24, 33, 100]) {
  const numbers = Array.from({ length: n }, (_, i) => (i < special.length ? special[(i * 7) % special.length] : i * 0.37 - 4));
  const a = Float64Array.from(numbers), b = Float32Array.from(numbers), o = new Float64Array(n), p = new Float32Array(n);
  for (const step of [negated64, magnitudes64, roots64]) { step(a, o); console.log(n, step.name, show(o)); }
  for (const step of [negated32, magnitudes32, roots32]) { step(b, p); console.log(n, step.name, show(p)); }
  lengths(a, o, o); console.log(n, show(o)); negated64(a, a); magnitudes64(a, a); console.log(n, show(a));
  ofIntegers(Int32Array.from({ length: n }, (_, i) => (i & 1 ? i : -i) * 3), o); console.log(n, show(o));
  for (const list of [numbers.filter(x => x === x), numbers.slice(), Array.from({ length: n }, (_, i) => i - 3)]) {
    const result = new Array(list.length).fill(0.5), again = list.slice();
    ofLists(list, result); console.log(n, show(result)); ofListsAgain(list, again); console.log(n, show(again)); ofLists(list, list); console.log(n, show(list));
  }
}
