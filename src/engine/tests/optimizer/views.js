const pattern = Uint8Array.from({ length: 24 }, (_, i) => i * 73 + 190);
const bytes = (type = ArrayBuffer, options) => { const b = new type(24, options); new Uint8Array(b).set(pattern); return b; };
globalThis.list = view => new Uint8Array(view.buffer).join();
const detached = () => { const view = new DataView(bytes()); view.buffer.transfer(); return view; };
const resized = (length, ...rest) => { const view = new DataView(bytes(ArrayBuffer, { maxByteLength: 40 }), ...rest); view.getInt8(0); view.buffer.resize(length); return view; };
const offsets = [0, 16, 17, 20, 21, 22, 23, 24, -1, 1.5, undefined];
const receivers = [() => new DataView(bytes(), 2), () => new DataView(bytes(), 2, 11), detached, () => resized(40), () => resized(12), () => resized(9, 0, 20), () => new Uint8Array(24), () => ({})];
for (const name of ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float16", "Float32", "Float64", "BigInt64", "BigUint64"]) {
  const stored = name.startsWith("Big") ? [0n, -2n, 2n ** 64n + 5n, 1] : [1, -2, 70000, 2 ** 32 + 3, 0.1, NaN, undefined, "7", 1n];
  check(`(v, o) => [show(v.get${name}(o)), show(v.get${name}(o, true)), show(v.get${name}(o, o & 1))]`, lazily(offsets, o => [new DataView(pattern.buffer), o]));
  check(`(v, x) => [v.set${name}(1, x), v.set${name}(9, x, true), v.set${name}(16, x, !x), list(v)]`, lazily(stored, x => [new DataView(bytes()), x]));
  check(`v => [v.set${name}(9, ${show(stored[1])}), show(v.get${name}(10))]`, lazily(receivers, make => [make()]));
}

for (const name of ["Int8Array", "Uint8Array", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "BigInt64Array", "BigUint64Array"]) {
  const type = globalThis[name], stored = name.startsWith("Big") ? [0n, -2n, 2n ** 64n + 5n, 1] : [1, -2, 70000, 2 ** 32 + 3, -0, 0.5, undefined];
  check(`(a, x) => [Atomics.add(a, 0, x), Atomics.sub(a, 1, x), Atomics.and(a, 2, x), Atomics.or(a, 0, x), Atomics.xor(a, 1, x), Atomics.exchange(a, 2, x), Atomics.store(a, 0, x),
    Atomics.compareExchange(a, 0, x, a[1]), Atomics.compareExchange(a, 1, x, a[2]), Atomics.load(a, 1)].map(show) + list(a) /* ${name} */`,
    lazily(stored, x => [new type(bytes(x ? SharedArrayBuffer : ArrayBuffer)), x]));
  check(`(a, i) => show(Atomics.load(a, i)) /* ${name} */`, lazily([0, 2, 24, -1, 1.5, undefined, Float32Array, Uint8ClampedArray, Array], i => (i?.of ? [i.of(1), 0] : [new type(pattern.buffer), i])));
}
check("a => [ArrayBuffer.isView(a)]", () => values().concat([new Int8Array(1), new DataView(bytes()), bytes()]).map(a => [a]));
check("(a, f) => { const seen = []; a.forEach((x, i) => { seen.push(x); if (!i) f(a); }); return seen; }", () =>
  [a => {}, a => a.buffer.transfer(), a => a.buffer.resize?.(1)].flatMap(f => [[new Uint8Array(3), f], [new Uint8Array(new ArrayBuffer(3, { maxByteLength: 8 })), f]]).concat([[new Uint8Array(0), () => {}]]));
const gone = () => { const a = new Uint8Array(0); a.buffer.transfer(); return a; }, shared = () => { const a = new Uint8Array(bytes()); return [a, a.subarray(0, 9), 3]; };
check("(a, b, o) => [a.set(b, o), list(a)]", () => [0, 5, 6, -1, undefined, 1.5].map(o => [new Uint8Array(8), Uint8Array.of(1, 2, 3), o]).concat([
  shared(), [gone(), new Uint8Array(0), 0], [new Uint8Array(2), gone(), 0], [new Int16Array(4), Uint16Array.of(65535), 3], [new Uint8ClampedArray(2), Int8Array.of(-1), 0],
  [new Uint8Array(4), new Uint8Array(new ArrayBuffer(2, { maxByteLength: 4 })).fill(7), 1], [new Uint8Array(4), [1, 2], 1],
]));
