function count(v, grow) { let n = 0, s = 0; for (let i = 0; i < v.length; i++) { n++; s = (s + (v[i] | 0)) | 0; if (i === 1) grow(); } return n + ":" + s + ":" + v.length; }
function fresh() { const shared = new SharedArrayBuffer(4, { maxByteLength: 16 }); const v = new Uint8Array(shared); v.fill(3); return [v, shared]; }
let told = "";
for (let round = 0; round < 6; round++) { const [v] = fresh(); told += count(v, () => {}) + " "; }
for (const to of [8, 16, 4]) { const [v, shared] = fresh(); told += count(v, () => shared.grow(to)) + " "; }
{ const [, shared] = fresh(); const b = Buffer.from(shared); told += count(b, () => shared.grow(12)); }
console.log(told);
