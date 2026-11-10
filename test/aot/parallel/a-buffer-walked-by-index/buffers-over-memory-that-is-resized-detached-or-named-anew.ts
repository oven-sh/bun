function len(b: Buffer, cut: () => void): number { let n = 0; for (let i = 0; i < b.length; i++) { n++; if (i === 1) cut(); } return n; }
function sum(b: Buffer): number { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]!; return s; }
const rab = (): any => new (ArrayBuffer as any)(4, { maxByteLength: 8 }); const p = rab(), q = rab(), r = rab(), d = Buffer.alloc(4), x = Buffer.alloc(4, 2), y = Buffer.alloc(4, 2); (x as any).x = 1; Object.defineProperty(y, "length", { value: 1 });
console.log(len(Buffer.alloc(4), () => {}), len(Buffer.from(p), () => p.resize(6)), len(Buffer.from(q, 0, 4), () => q.resize(6)), len(Buffer.from(r, 0, 4), () => r.resize(2)), len(d, () => { structuredClone(d.buffer, { transfer: [d.buffer] as any }); }), sum(x), sum(y));
