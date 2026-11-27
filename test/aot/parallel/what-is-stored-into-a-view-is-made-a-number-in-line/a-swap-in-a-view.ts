function partition(a: Float64Array, from: number, to: number): number { const pivot = a[to]; let i = from; for (let j = from; j < to; j++) if (a[j] < pivot) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; } a[to] = a[i]; a[i] = pivot; return i; }
let s = ""; for (let r = 0; r < 200; r++) { const a = Float64Array.of(5, 1, 4, 2, 3); s = partition(a, 0, 4) + " " + a.join(); }
const b = Float64Array.of(5, 1, NaN, -0, 2); console.log(s, partition(b, 0, 4), b.join(), Object.is(b[1], -0), partition(Float64Array.of(2, 1), 0, 5));
