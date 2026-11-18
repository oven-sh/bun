const types = [
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
];
const bytes = () => Uint8Array.from({ length: 64 }, (_, i) => (i * 73 + 190) & 255).buffer;
globalThis.list = view => Array.from(view, show).join();
const keys = [0, 3, 7, -0, 2.5, -1, 64, 2 ** 31, 2 ** 32 + 1, NaN, "1"];
const numbers = [5, -1, 300, 2 ** 31, -(2 ** 31) - 1, 0.5, 1.5, 254.5, 1e300, NaN, -0, true, undefined, null, "7", 2049.0000001];
const bigints = [0n, 5n, -1n, 2n ** 63n, -(2n ** 64n) - 3n, 7];

for (const name of types) {
  const type = globalThis[name], stored = () => [...(name.startsWith("Big") ? bigints : numbers), { valueOf: () => 2 }];
  check(`(a, i) => a[i] /* ${name} */`, () => keys.map(key => [new type(bytes()), key]));
  check(`(a, i) => (a[i] = a[1], list(a)) /* ${name} */`, () => keys.map(key => [new type(bytes()), key]));
  check(`(a, v) => (a[2] = v, list(a)) /* ${name} */`, () => stored().map(value => [new type(4), value]));
  check(`a => [a.length, a.byteLength, a.byteOffset, show(a[1])] /* ${name} */`, () => {
    const gone = new type(bytes(), 8, 2), buffer = new ArrayBuffer(32, { maxByteLength: 64 });
    gone.buffer.transfer();
    return [[new type(3)], [new type(bytes(), 16)], [gone], [new type(buffer, 8)], [new type(buffer, 8, 1)], [new type(2000)]];
  });
}

check("(a, i) => show(a[i])", () => types.map(name => [new globalThis[name](bytes()), 2]).concat([[[1, 2, 3], 2], ["abc", 2], [7, 2]]));
check("(a, i) => a[i >>> 0]", () => [0, 5, -1, 64].map(key => [new Uint8Array(bytes()), key]));
check("(a, i) => (a[i] | 0) + (a[i] >>> 0) + a[i]", () => [0, 1, 2, 3, 99].map(key => [new Uint32Array([1, 2 ** 31, 2 ** 32 - 1, 0]), key]));
check("(a, b) => { b[0] = 0x7ff4; b[1] = b[2] = b[3] = -1; const list = [a[0]]; return [typeof list[0], list[0], -a[0]]; }", () => {
  const buffer = new ArrayBuffer(8);
  return [Float16Array, Float32Array, Float64Array].map(type => [new type(buffer), new Uint16Array(buffer)]);
});
check("(a, b) => { a[0] = 258; const first = b[0]; b[1] = 7; return [first, a[0]]; }", () => {
  const buffer = new ArrayBuffer(8);
  return [[new Int32Array(buffer), new Uint8Array(buffer)], [new Int32Array(2), new Uint8Array(8)]];
});
check("a => { class C { constructor() { return a; } } return list(new (class extends C { 1 = 9; })()); }", () => [[new Int8Array(2)], [new Int8Array(1)]]);

// Buffers that change between two accesses.
const changes = () => [
  () => {},
  view => view.buffer,
  view => view.buffer.transfer(),
  view => view.buffer.resize?.(2),
  view => view.buffer.resizable && view.buffer.resize(32),
  view => view.buffer.growable && view.buffer.grow(32),
];
const views = () => [
  new Uint8Array(8),
  new Uint8Array(new ArrayBuffer(8, { maxByteLength: 32 })),
  new Uint8Array(new ArrayBuffer(8, { maxByteLength: 32 }), 1, 6),
  new Uint8Array(new SharedArrayBuffer(8, { maxByteLength: 32 })),
];
for (let which = 0; which < 4; which++) {
  check(`(a, change) => { a[4] = 1; const before = [a[4], a[20], a.length]; change(a); a[5] = 2; a[20] = 3; return [before, a[4], a[5], a[20], a.length, a.byteOffset, list(a)]; } /* ${which} */`,
    () => changes().map(change => [views()[which], change]));
  check(`(a, change) => { let sum = 0; for (let i = 0; i < a.length; i++) { a[i] = i; if (i === 1) change(a); sum += a[i]; } return sum; } /* ${which} */`,
    () => changes().map(change => [views()[which], change]));
}

// Views that are constants of the code.
for (const size of [8, 5000]) {
  for (let which = 0; which < 4; which++) {
    const make = (0, eval)(`(view, change) => turn => { view[1] = turn; if (turn === 70) change(view); view[2] = turn; return [view[1], view[2], view.length, view.byteLength]; }`);
    const view = which === 3 ? new Uint8Array(new ArrayBuffer(size, { maxByteLength: size })) : new Uint8Array(size);
    const step = make(view, changes()[which]), left = [size, size, 0, 2][which];
    for (let turn = 0; turn < 90; turn++) {
      const length = turn < 70 ? size : left;
      const expected = [length > 1 ? turn : undefined, length > 2 ? turn : undefined, length, length];
      if (show(step(turn)) !== show(expected)) throw new Error(`size ${size}, change ${which}, turn ${turn}`);
    }
    if (left > 2 && new Uint8Array(view.buffer)[2] !== 89) throw new Error("the buffer has other bytes");
  }
}

const grown = type => {
  const buffer = new type(8, { maxByteLength: 32 }), view = new Uint8Array(buffer);
  (buffer.resize ?? buffer.grow).call(buffer, 32);
  new DataView(buffer).setUint8(20, 7);
  return view;
};
for (const body of ["a[20]", "20 in a", "(a[20] = 3, new Uint8Array(a.buffer)[20])"])
  check(`a => ${body}`, () => [[new Uint8Array(8)], [grown(ArrayBuffer)], [grown(SharedArrayBuffer)]]);

// The code that is running goes on with a view that is given a buffer for better code, which inlines more.
for (let padding = 10; padding < 60; padding += 10) {
  const table = new Int32Array(4);
  const last = (0, eval)(`table => x => { ${"x = (x + 1) | 0;".repeat(padding)} return table[1] + x; }`)(table);
  const count = (0, eval)("last => (view, n) => { view[0] = 0; for (let i = 0; i < n; i++) view[0]++; return last(n); }")(last);
  for (const n of [12, 12, 3000]) {
    Reflect.apply(count, null, [table, n]);
    if (list(table) !== n + ",0,0,0") throw new Error(`${list(table)} after ${n}`);
  }
}

// Nothing but the vector is needed after the allocations.
check("n => { const a = new Float64Array(n); a[0] = 1; a[n - 1] = 2.5; let kept; for (let i = 0; i < 300; i++) kept = { i }; return a[n - 1] + kept.i; }", () => [[4], [4000]]);
check("(a, change) => { const before = [a.byteLength, a.byteOffset]; change(a); return [before, a.byteLength, a.byteOffset]; }", () =>
  changes().flatMap(change => [new DataView(new ArrayBuffer(8), 2), new Int16Array(new ArrayBuffer(8, { maxByteLength: 32 }), 4)].map(a => [a, change])));
