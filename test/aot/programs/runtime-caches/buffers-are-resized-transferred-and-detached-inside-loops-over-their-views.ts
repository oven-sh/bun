// Loops over typed arrays whose buffers are resized, transferred or detached by a call inside the loop.
function show(f: () => unknown): string { try { return String(f()); } catch (e: any) { return "threw " + e.constructor.name; } }
type Bytes = Uint8Array;
function sum(a: Bytes, at: number, then: () => void): number { let t = 0; for (let i = 0; i < a.length; i++) { if (i === at) then(); t += a[i]; } return t; }
function sumKept(a: Bytes, at: number, then: () => void): string { let t = 0; const n = a.length; let holes = 0; for (let i = 0; i < n; i++) { if (i === at) then(); const v = a[i]; if (v === undefined) holes++; else t += v; } return t + "/" + holes; }
function fill(a: Bytes, at: number, then: () => void): string { const n = a.length; for (let i = 0; i < n; i++) { if (i === at) then(); a[i] = 7; } return a.length + ":" + a.byteLength + ":" + a.byteOffset; }
function floats(a: Float64Array, at: number, then: () => void): string { const n = a.length; let t = 0; for (let i = 0; i < n; i++) { if (i === at) then(); a[i] = 1.5; t += a[i]; } return String(t); }
function each(a: Bytes, at: number, then: () => void): string { let t = 0, c = 0; a.forEach((v, i) => { if (i === at) then(); t += v === undefined ? 1000 : v; c++; }); return t + "/" + c; }
function of(a: Bytes, at: number, then: () => void): string { let t = 0, i = 0; for (const v of a) { if (i++ === at) then(); t += v; } return t + "/" + i; }
function view(v: DataView, at: number, then: () => void): string { let t = 0; const n = v.byteLength; for (let i = 0; i < n; i++) { if (i === at) then(); t += v.getUint8(i); } return String(t); }
function mapped(a: Bytes, at: number, then: () => void): string { return a.map((v, i) => { if (i === at) then(); return v + 1; }).join(); }
function sorted(a: Bytes, then: () => void): string { let once = true; return a.sort((x, y) => { if (once) { once = false; then(); } return y - x; }).join(); }

for (const size of [8, 64, 3000]) {
    const events: [string, (b: ArrayBuffer) => void][] = [
        ["shrink", b => b.resize(3)], ["empty", b => b.resize(0)], ["grow", b => b.resize(size * 2)], ["transfer", b => { b.transfer(); }], ["transfer smaller", b => { b.transfer(1); }],
        ["clone away", b => { structuredClone(b, { transfer: [b] }); }], ["shrink and collect", b => { b.resize(1); Bun.gc(true); const junk = []; for (let i = 0; i < 100; i++) junk.push(new Uint8Array(size)); }],
        ["post away", b => { const c = new MessageChannel(); c.port1.postMessage(b, [b]); c.port1.close(); c.port2.close(); }],
    ];
    for (const [name, event] of events) for (const resizable of [true, false]) for (const tracking of [true, false]) for (const offset of [0, 8]) {
        if (!resizable && /shrink|empty|grow/.test(name)) continue;
        const make = () => { const b = resizable ? new ArrayBuffer(size + 8, { maxByteLength: size * 2 + 16 }) : new ArrayBuffer(size + 8); new Uint8Array(b).fill(1); return b; };
        const bytes = (b: ArrayBuffer) => tracking ? new Uint8Array(b, offset) : new Uint8Array(b, offset, size);
        const line: string[] = [];
        const at = size >> 1;
        for (const run of [sum, sumKept, fill, each, of, mapped]) { const b = make(); const a = bytes(b); line.push(show(() => run(a, at, () => event(b))) + "~" + a.length); }
        { const b = make(); const a = tracking ? new Float64Array(b, offset) : new Float64Array(b, offset, size >> 3); line.push(show(() => floats(a, size >> 4, () => event(b)))); }
        { const b = make(); const v = tracking ? new DataView(b, offset) : new DataView(b, offset, size); line.push(show(() => view(v, at, () => event(b)))); }
        if (size < 100) { const b = make(); const a = bytes(b); line.push(show(() => sorted(a, () => event(b)))); }
        const text = line.join(" ; ");
        console.log(size, name, resizable, tracking, offset, text.length > 400 ? text.length + " " + Bun.hash(text) : text);
    }
}
