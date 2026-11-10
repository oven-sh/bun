function sum(b, bytes, at, to) { let s = 0, turns = 0; for (let i = 0; i < b.length; i++) { if (i === at) bytes.resize(to); s = (s + (b[i] | 0)) | 0; turns++; } return s + ":" + turns + ":" + b.length; }
function fresh() { const bytes = new ArrayBuffer(16, { maxByteLength: 16 }); const b = Buffer.from(bytes); for (let i = 0; i < 16; i++) b[i] = i + 1; return [b, bytes]; }
let told = "";
for (let round = 0; round < 6; round++) { const [b, bytes] = fresh(); told += sum(b, bytes, -1, 0) + " "; }
for (const [at, to] of [[3, 4], [3, 2], [0, 0], [15, 8], [8, 16]]) { const [b, bytes] = fresh(); told += sum(b, bytes, at, to) + " "; }
console.log(told);
