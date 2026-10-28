// Views of bytes are read and written in loops while the memory behind them is transferred, resized or grown by code the loop calls.
function sum(view: Uint8Array, each: (i: number) => void): number { let t = 0; for (let i = 0; i < view.length; i++) { t += view[i]; each(i); } return t; }
function fill(view: Uint8Array, each: (i: number) => void): number { let n = 0; for (let i = 0; i < view.length; i++) { each(i); view[i] = i; n++; } return n; }
function sumFixed(view: Float64Array, n: number, each: (i: number) => void): number { let t = 0; for (let i = 0; i < n; i++) { const x = view[i]; t += x === undefined ? -1 : x; each(i); } return t; }
function sumBuffer(view: Buffer, each: (i: number) => void): number { let t = 0; for (let i = 0; i < view.length; i++) { t += view[i] + view.readUInt8(i); each(i); } return t; }
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
for (let round = 0; round < 3; round++) {
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(1); console.log("transfer", attempt(() => sum(v, i => { if (i === 5) b.transfer(); })), v.length); }
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(1); console.log("transfer in a fill", attempt(() => fill(v, i => { if (i === 5) b.transfer(8); })), v.length); }
    { const b = new ArrayBuffer(64, { maxByteLength: 4096 }); const v = new Uint8Array(b).fill(1); console.log("shrink", attempt(() => sum(v, i => { if (i === 5) b.resize(8); })), v.length); }
    { const b = new ArrayBuffer(64, { maxByteLength: 4096 }); const v = new Uint8Array(b).fill(1); console.log("grow", attempt(() => sum(v, i => { if (i === 5) b.resize(128); })), v.length); }
    { const b = new ArrayBuffer(64, { maxByteLength: 4096 }); const v = new Uint8Array(b, 8, 16).fill(1); console.log("shrink below a window", attempt(() => sum(v, i => { if (i === 5) b.resize(4); })), v.length, v.byteOffset); }
    { const b = new ArrayBuffer(64, { maxByteLength: 4096 }); const v = new Uint8Array(b).fill(1); console.log("shrink in a fill", attempt(() => fill(v, i => { if (i === 5) b.resize(8); })), v.length); }
    { const b = new ArrayBuffer(256); const v = new Float64Array(b).fill(1.5); console.log("clone away", attempt(() => sumFixed(v, 32, i => { if (i === 5) structuredClone(b, { transfer: [b] }); })), v.length); }
    { const b = new ArrayBuffer(256, { maxByteLength: 512 }); const v = new Float64Array(b).fill(1.5); console.log("resize under doubles", attempt(() => sumFixed(v, 32, i => { if (i === 5) b.resize(64); if (i === 20) b.resize(512); })), v.length); }
    { const b = new ArrayBuffer(64); const v = Buffer.from(b).fill(1); console.log("buffer transfer", attempt(() => sumBuffer(v, i => { if (i === 5) b.transfer(); })), v.length); }
    { const b = new ArrayBuffer(64, { maxByteLength: 128 }); const v = Buffer.from(b).fill(1); console.log("buffer shrink", attempt(() => sumBuffer(v, i => { if (i === 5) b.resize(8); })), v.length); }
    { const m = new WebAssembly.Memory({ initial: 1, maximum: 4 }); const v = new Uint8Array(m.buffer, 0, 64).fill(1); console.log("memory grows", attempt(() => sum(v, i => { if (i === 5) m.grow(1); })), v.length); }
    { const c = new MessageChannel(); const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(1); console.log("posted away", attempt(() => sum(v, i => { if (i === 5) c.port1.postMessage(b, [b]); })), v.length); c.port1.close(); c.port2.close(); }
    { const b = new ArrayBuffer(64); const v = new DataView(b); console.log("data view", attempt(() => { let t = 0; for (let i = 0; i < 8; i++) { t += v.getUint8(i) + 1; if (i === 3) b.transfer(); } return t; })); }
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(2); console.log("methods", attempt(() => v.map((x, i) => { if (i === 3) b.transfer(); return x; }).join("")), attempt(() => v.indexOf(2)), attempt(() => v.subarray(1).length)); }
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(2); console.log("sort", attempt(() => v.sort((x, y) => { b.transfer(); return x - y; }).length)); }
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(2); console.log("index by an object", attempt(() => v[{ valueOf() { b.transfer(); return 1; } } as unknown as number]), attempt(() => { v[1] = { valueOf() { return 7; } } as unknown as number; return v[1]; })); }
    { const b = new ArrayBuffer(64); const v = new Uint8Array(b).fill(2); console.log("stored value detaches", attempt(() => { v[1] = { valueOf() { b.transfer(); return 7; } } as unknown as number; return v[1]; }), attempt(() => v.fill({ valueOf() { return 1; } } as unknown as number).length)); }
}
