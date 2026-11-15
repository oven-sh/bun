function term(i: number, j: number): number { return 1 / ((i + j) * (i + j + 1) / 2 + i + 1); }
function times(u: Float64Array, v: Float64Array): void {
  const n = u.length;
  for (let i = 0; i < n; ++i) {
    let t = 0;
    for (let j = 0; j < n; ++j) t += term(i, j) * u[j];
    v[i] = t;
  }
}
function squares(view: Int32Array): number { let sum = 0; for (let i = 0; i < view.length; i++) sum += i * i * view[i]; return sum; }
function corners(view: Uint16Array): number { const n = view.length; return (n - 1) * (n - 1) + n * n; }
function bytes(view: Uint8Array): number { const n = view.length; return n * n + (n - 1) * n; }
const u = new Float64Array(300).fill(1), v = new Float64Array(300);
times(u, v);
console.log(v[0], v[1], v[150], v[299]);
console.log(squares(new Int32Array(2000).fill(3)), squares(new Int32Array(0)));
console.log(corners(new Uint16Array(65536)), corners(new Uint16Array(1)), corners(new Uint16Array(0)));
console.log(bytes(new Uint8Array(100000)), bytes(new Uint8Array(0)));
