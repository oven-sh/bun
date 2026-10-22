// Atomics on integer typed arrays with number index and operands compile to atomic instructions. Results, stored values and exceptions must match the runtime functions.
declare const console: { log(...v: unknown[]): void };
function counts(slots: Int32Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) { t += Atomics.add(slots, 0, 1); Atomics.sub(slots, 1, 2); Atomics.store(slots, 2, i); t += Atomics.load(slots, 2); } return t + Atomics.load(slots, 0) * 3 + Atomics.load(slots, 1) * 5; }
function swaps(slots: Int32Array, n: number): number { let retries = 0; for (let i = 0; i < n; i++) { let held = Atomics.load(slots, 3); while (Atomics.compareExchange(slots, 3, held, held + 3) !== held) { retries++; held = Atomics.load(slots, 3); } } return retries * 1000 + Atomics.exchange(slots, 3, -1) + Atomics.load(slots, 3); }
function said(run: () => unknown): string { try { const v = run(); return Object.is(v, -0) ? "-0" : String(v); } catch (e) { return (e as Error).constructor.name; } }

function int8(a: Int8Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x55), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7f), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function uint8(a: Uint8Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x55), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7f), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function int16(a: Int16Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x5555), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7fff), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function uint16(a: Uint16Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x5555), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7fff), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function int32(a: Int32Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x55555555), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7fffffff), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function uint32(a: Uint32Array, i: number, v: number): string { return [Atomics.add(a, i, v), Atomics.and(a, i, v | 0x55555555), Atomics.or(a, i, v), Atomics.xor(a, i, 0x7fffffff), Atomics.sub(a, i, v), Atomics.exchange(a, i, v), Atomics.compareExchange(a, i, v, v + 1), Atomics.load(a, i), Atomics.store(a, i, v), a[i]].join(); }
function stores(a: Int32Array, v: number): string { return said(() => Atomics.store(a, 0, v)) + ":" + a[0]; }
function loads(a: Int32Array, i: number): string { return said(() => Atomics.load(a, i)); }
function adds(a: Int32Array, i: number, v: number): string { return said(() => Atomics.add(a, i, v)) + ":" + a[0]; }
function floats(a: Float64Array): string { return said(() => Atomics.load(a as any, 0)) + said(() => Atomics.add(a as any, 0, 1)); }
function clamped(a: Uint8ClampedArray): string { return said(() => Atomics.load(a as any, 0)) + said(() => Atomics.store(a as any, 0, 1)); }
function big(a: BigInt64Array): string { return said(() => Atomics.add(a, 0, 5n)) + said(() => Atomics.load(a, 0)) + said(() => Atomics.add(a as any, 0, 5)); }
class Own extends Int32Array { get length(): number { return 0; } }

const shared = new Int32Array(new SharedArrayBuffer(64));
const own = new Int32Array(16);
const out: string[] = [];
out.push(String(counts(shared, 1000)), String(swaps(shared, 1000)), String(counts(own, 10)), String(swaps(own, 10)));
for (const v of [1, -1, 127, 128, 255, 256, 65535, 65536, 2147483647, -2147483648, 4294967295, 4294967296, 1.9, -1.9, 0, -0, NaN, Infinity, -Infinity, 1e20]) {
  out.push(int8(new Int8Array(4), 1, v), uint8(new Uint8Array(4), 2, v), int16(new Int16Array(4), 3, v), uint16(new Uint16Array(4), 0, v), int32(new Int32Array(4), 1, v), uint32(new Uint32Array(4), 2, v), stores(own, v));
}
for (const i of [0, 15, 16, -1, 1.5, -0, NaN, Infinity, 4294967296, 1e20]) out.push(loads(own, i), adds(own, i, 1));
out.push(floats(new Float64Array(2)), clamped(new Uint8ClampedArray(2)), big(new BigInt64Array(2)));
const resizable = new ArrayBuffer(16, { maxByteLength: 64 }); const tracking = new Int32Array(resizable); const fixed = new Int32Array(resizable, 0, 2);
out.push(adds(tracking, 3, 7), loads(tracking, 4), loads(fixed, 1), loads(fixed, 2)); resizable.resize(32); out.push(loads(tracking, 4), adds(tracking, 7, 1), loads(fixed, 1)); resizable.resize(4); out.push(loads(tracking, 1), loads(tracking, 0), loads(fixed, 0), adds(fixed, 1, 1));
const growable = new SharedArrayBuffer(8, { maxByteLength: 32 }); const grown = new Int32Array(growable); out.push(loads(grown, 2)); growable.grow(16); out.push(loads(grown, 2), adds(grown, 3, 9), loads(grown, 3));
const gone = new Int32Array(4); structuredClone(gone.buffer, { transfer: [gone.buffer] }); out.push(loads(gone, 0), adds(gone, 0, 1), stores(gone, 1));
const subclass = new Own(4); out.push(adds(subclass, 3, 4), loads(subclass, 3), loads(subclass, 4));
out.push(said(() => Atomics.load(undefined as unknown as Int32Array, 0)), said(() => Atomics.add(null as unknown as Int32Array, 0, 1)), said(() => Atomics.add([1, 2] as any, 0, 1)));
console.log(out.join(" "));
