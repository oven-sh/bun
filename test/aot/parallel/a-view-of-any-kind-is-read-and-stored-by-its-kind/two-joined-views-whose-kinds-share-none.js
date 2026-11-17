function run(n, wide, deep) {
  const a = wide ? new Int16Array(n) : new Int8Array(n);
  const b = deep ? new Float64Array(n) : new Float32Array(n);
  for (let i = 0; i < a.length; i++) a[i] = i - 7;
  for (let i = 0; i < b.length; i++) b[i] = i * 3;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
const n = +(process.argv[2] ?? 3);
let out = 0;
for (let turn = 0; turn < n; turn++) out += run(300, turn & 1, turn & 2) + run(4, turn & 2, turn & 1) + run(0, 1, 0);
console.log("SAID", out);
