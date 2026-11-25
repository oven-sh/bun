// Typed arrays in module constants, under masked and shifted keys, whose length fits, is one short, is zero, changes, or ends; and counters that a loop compares at a distance.
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) table[n] = Math.imul(n + 1, 2654435761);
const short = new Uint8Array(200).fill(7);
const none = new Uint16Array(0);
const floats = new Float64Array(64).map((_, i) => i / 3);
const codes = new Uint8Array(64).map((_, i) => 33 + i);
const resizable = new ArrayBuffer(256, { maxByteLength: 1024 });
const tracking = new Uint8Array(resizable);
const growing = new SharedArrayBuffer(64, { maxByteLength: 256 });
const shared = new Uint8Array(growing);
let detachable = new Uint8Array(256).fill(9);
function crc(data: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function masked(view: any, n: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    const x = view[(i * 37) & 255];
    if (x === undefined) holes++;
    else sum += x;
  }
  return sum + "/" + holes;
}
function shortMasked(n: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    const x = short[(i * 37) & 255];
    if (x === undefined) holes++;
    else sum += x;
  }
  return sum + "/" + holes;
}
function noneMasked(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + none[i & 15]) | 0;
  return sum;
}
function shifted(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + table[Math.imul(i, 0x9e3779b9) >>> 24] + codes[(i >> 2) & 63]) | 0;
  return sum;
}
function trackingMasked(n: number, resizeAt: number, to: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (i === resizeAt) resizable.resize(to);
    const x = tracking[i & 255];
    if (x === undefined) holes++;
    else sum += x + 1;
  }
  return sum + "/" + holes;
}
function sharedMasked(n: number, growAt: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (i === growAt) growing.grow(128);
    const x = shared[i & 127];
    if (x === undefined) holes++;
    else sum += x + 1;
  }
  return sum + "/" + holes;
}
function detachedMasked(n: number, detachAt: number): string {
  const view = detachable;
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (i === detachAt) structuredClone(view.buffer, { transfer: [view.buffer] });
    const x = view[i & 255];
    if (x === undefined) holes++;
    else sum += x;
  }
  return sum + "/" + holes;
}
function store(n: number): string {
  const ring = new Float64Array(16);
  const tiny = new Int8Array(3);
  for (let i = 0; i < n; i++) {
    ring[i & 15] += i / 2;
    tiny[i & 7] = i;
    floats[(i * 5) & 63] = ring[i & 15];
  }
  return ring.join() + " " + tiny.join() + " " + floats[63];
}
function encode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.floor(data.length / 3) * 4);
  let o = 0;
  for (let i = 0; i + 2 < data.length; i += 3) {
    const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out[o++] = codes[n >> 18];
    out[o++] = codes[(n >> 12) & 63];
    out[o++] = codes[(n >> 6) & 63];
    out[o++] = codes[n & 63];
  }
  return out;
}
function distances(list: number[], text: string, view: Uint8Array): string {
  let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
  for (let i = 0; i + 1 < list.length; i++) a += list[i + 1] - list[i];
  for (let i = 0; i + 3 <= text.length; i += 2) b += text.charCodeAt(i + 2);
  for (let i = 0; 5 + i < view.length; i += 5) c += view[i + 5] + i;
  for (let i = 0; i + 1 < list.length; i += 2) { if (list[i] > 3) i++; d += i; }
  for (let i = 0; i + 2 < list.length; i++) { if (list[i] === 2) list.push(7); e += i; if (list.length > 40) break; }
  for (let i = 0; view.length > i + 4; i += 4) { if (view[i] === 3) i -= 2; f += i; if (f > 1e6) break; }
  return [a, b, c, d, e, f].join();
}
const data = new Uint8Array(1000).map((_, i) => (i * 31) ^ (i >> 3));
for (let turn = 0; turn < 3; turn++) {
  console.log(crc(data), crc(data.subarray(1)), crc(new Uint8Array(0)), shifted(5000));
  console.log(masked(table, 1000), masked(short, 1000), masked(none, 10), masked(floats, 300), masked([1, 2, 3], 300), shortMasked(1000), noneMasked(100));
  console.log(trackingMasked(600, turn === 1 ? 300 : -1, 100), trackingMasked(600, turn === 2 ? 10 : -1, 512), sharedMasked(400, turn === 1 ? 77 : -1), detachedMasked(700, turn === 2 ? 500 : -1));
  console.log(store(1000), encode(data).join("").length, crc(encode(data)), crc(encode(data.subarray(0, 2))), crc(encode(data.subarray(3, 7))));
  console.log(distances([1, 2, 3, 4, 5, 2, 9, 8, 7], "some text with a ÿ end", data), distances([], "", new Uint8Array(0)), distances([5], "ab", new Uint8Array(4)), distances([2, 2], "abc", new Uint8Array(5)), distances([4, 5, 6], "日bcd", new Uint8Array(6).fill(3)));
}
