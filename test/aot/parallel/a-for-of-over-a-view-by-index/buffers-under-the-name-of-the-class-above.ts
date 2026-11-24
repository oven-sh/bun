function total(v: Uint8Array): number { let s = 0; for (const x of v) s += x; return s; }
function act(v: Uint8Array, f: (n: number) => void): number { let n = 0; for (const x of v) { n++; f(n); if (x === 255) break; } return n; }
function tell(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name; } }
const rab = (): any => new (ArrayBuffer as any)(3, { maxByteLength: 6 }), r = rab(), q = rab(), own = Buffer.from([1, 2]), d = Buffer.from(new ArrayBuffer(3)); (own as any)[Symbol.iterator] = function* () { yield 60; };
console.log(total(Uint8Array.of(1, 2, 3, 4)), total(Buffer.from([1, 2, 3, 4])), act(Buffer.alloc(3), () => {}), act(Buffer.from(r), n => { if (n < 4) r.resize(r.byteLength + 1); }), total(own), act(Buffer.from(q, 0, 3), n => { if (n === 1) q.resize(4); }), tell(() => act(d, n => { if (n === 1) structuredClone(d.buffer, { transfer: [d.buffer] as any }); })));
