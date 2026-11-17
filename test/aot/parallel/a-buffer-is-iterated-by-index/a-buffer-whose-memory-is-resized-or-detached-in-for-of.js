function walk(b, at, deed) { let s = 0, turns = 0; try { for (const x of b) { if (turns === at) deed(); s = (s + (x | 0)) | 0; turns++; } } catch (error) { return error.constructor.name + ":" + turns; } return s + ":" + turns + ":" + b.length; }
function fresh() { const bytes = new ArrayBuffer(8, { maxByteLength: 16 }); const b = Buffer.from(bytes); for (let i = 0; i < 8; i++) b[i] = i + 1; return [b, bytes]; }
let told = "";
for (let round = 0; round < 4; round++) { const [b] = fresh(); told += walk(b, -1, () => {}) + " "; }
for (const to of [2, 0, 8, 16]) { const [b, bytes] = fresh(); told += walk(b, 1, () => bytes.resize(to)) + " "; }
{ const [, bytes] = fresh(); const fixed = Buffer.from(bytes, 0, 4); told += walk(fixed, 1, () => bytes.resize(2)) + " "; }
{ const plain = Buffer.alloc(4, 3); told += walk(plain, 1, () => { structuredClone(plain.buffer, { transfer: [plain.buffer] }); }) + " "; }
{ const shared = new SharedArrayBuffer(4, { maxByteLength: 16 }); const b = Buffer.from(shared); b.fill(2); told += walk(b, 1, () => shared.grow(12)); }
console.log(told);
