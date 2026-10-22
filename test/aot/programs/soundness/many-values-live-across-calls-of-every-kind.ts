// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
function add(a: number, b: number): number { return a + b; }
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10; }
function manyFractions(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a / 2 + b / 4 + c / 8 + d / 16 + e / 32 + f / 64 + g / 128 + h / 256 + i / 512 + j / 1024; }
function mixedKinds(a: number, b: string, c: number, d: number[], e: number, f: boolean, g: number, h: string | undefined): number { return a + b.length + c + d.length + e + (f ? 1 : 0) + g + (h ? h.length : 0); }
function busy(a: number): number { let p = a, q = a + 1, r = a + 2, s = a + 3, t = a + 4, u = a + 5, v = a + 6, w = a + 7; for (let at = 0; at < 3; at++) { p += add(q, r); q ^= p; r += s; s ^= add(t, u); t += u; u ^= v; v += w; w ^= p; } return (p + q + r + s + t + u + v + w) | 0; }
function busyFractions(a: number): number { let p = a, q = a + 1.5, r = a + 2.5, s = a + 3.5, t = a + 4.5, u = a + 5.5, v = a + 6.5, w = a + 7.5, x = a + 8.5, y = a + 9.5; for (let at = 0; at < 3; at++) { p += Math.sin(q); q += r / 2; r += s / 2; s += t / 2; t += u / 2; u += v / 2; v += w / 2; w += x / 2; x += y / 2; y += p / 2; } return p + q + r + s + t + u + v + w + x + y; }
function tail(a: number, b: number): number { "use strict"; return a <= 0 ? b : tail(a - 1, b + a); }
function passesMore(a: number, b: number): number { "use strict"; return many(a, b, 1, 2, 3, 4, 5, 6, 7, a + b); }
function passesFewer(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { "use strict"; return add(a + j, b + i + c + d + e + f + g + h); }
function defaults(a: number, b = a + 1, c = b * 2): number { return a + b + c; }
function pair(a: number): [number, number] { return [a, a + 1]; }
const anyFunctions: ((a: number, b: number) => number)[] = [add, (a, b) => a - b, Math.max, function (a, b) { return a * b; }, add.bind(null, 5), Math.imul];
const receiver = { base: 10, plus(a: number) { return this.base + a; } };
const proxied = new Proxy({ a: 1 } as Record<string, number>, { get(target, key) { return key === "a" ? 41 : (key as string).length; }, has() { return true; }, set() { return true; } });
const primitive = { [Symbol.toPrimitive](hint: string) { return hint.length; } };
const withToString = { toString() { return "text"; } }, withValueOf = { valueOf() { return 6; } };
const moduleBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 11, 2, 96, 1, 127, 1, 127, 96, 1, 124, 1, 124, 3, 3, 2, 0, 1, 7, 17, 2, 6, 116, 114, 105, 112, 108, 101, 0, 0, 4, 104, 97, 108, 102, 0, 1, 10, 24, 2, 7, 0, 32, 0, 65, 3, 108, 11, 14, 0, 32, 0, 68, 0, 0, 0, 0, 0, 0, 224, 63, 162, 11]);
const exported = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes)).exports as { triple(value: number): number; half(value: number): number };

function smallFunction(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = add(k, 1);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tenIntegers(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = many(k, 1, 2, 3, 4, 5, 6, 7, 8, k);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tenFractions(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = manyFractions(k + 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, k + 9.5) * 1024 | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function argumentsOfMixedKinds(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = mixedKinds(k, seed[k % 8], k + 0.5, list, 3, k % 2 === 0, 2.25, k % 3 ? undefined : seed[0]) * 4 | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function calleeUsesEveryRegister(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = busy(k);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function calleeUsesEveryFractionRegister(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = busyFractions(k) * 16 | 0;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tailCalls(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = tail(k, 0);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tailCallsWithMoreArguments(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = passesMore(k, 2);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tailCallsWithFewerArguments(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = passesFewer(k, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function defaultParameters(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = defaults(k) + defaults(k, 1) + defaults(k, undefined, 2);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function twoResults(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const [first, second] = pair(k);
    const n = first * second;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function unknownCallee(seed: string[], rounds: number, functions: ((a: number, b: number) => number)[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = functions[k % functions.length](k, 3);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function methodOfObject(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = receiver.plus(k);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function callAndApply(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = add.call(null, k, 1) + add.apply(null, [k, 2]) + receiver.plus.call({ base: 1 }, k) + Reflect.apply(add, null, [k, 3]);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function boundFunctions(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const bound = add.bind(null, 7);
  for (let k = 0; k < rounds; k++) {
    const n = bound(k) + add.bind(null, k, 2)();
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function tooFewAndTooManyArguments(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = ((add as any)(k) | 0) + (add as any)(k, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function constructors(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = new (class { v: number; constructor(v: number) { this.v = v * 2; } })(k).v + Reflect.construct(Array, [k % 5]).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function mapAndFilter(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = list.map(value => value * k).filter(value => value % 2 === 0).length + list.reduce((sum, value) => sum + value, k);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function forEachAndSome(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    list.forEach(value => { n += value + k; });
    n += (list.some(value => value > k) ? 1 : 0) + (list.every(value => value < k) ? 2 : 0) + (list.find(value => value === k % 5) ?? -1) + list.findIndex(value => value === k % 5);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function sortWithComparator(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = list.slice().sort((a, b) => (a ^ k) - (b ^ k))[0] + list.toSorted((a, b) => b - a)[0];
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function replaceWithFunction(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = seed[k % 8].replace(/[aeiou]/g, vowel => vowel + k).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function reviverAndReplacer(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = JSON.parse("[1,2,3]", (key, value) => typeof value === "number" ? value + k : value)[2] + JSON.stringify({ a: k, b: 2 }, (key, value) => key === "b" ? undefined : value).length + JSON.stringify({ toJSON() { return k; } }).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function arrayFromWithFunction(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = Array.from({ length: 3 }, (_, at) => at * k)[2] + Array.from(new Set([k, 1]), value => value + 1).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function proxies(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    object.b = k;
    const n = object.a + object[seed[k % 8]] + ("zz" in object ? 1 : 0);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function conversionsThatRunCode(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = +(primitive as any) + `${primitive as any}`.length + (withToString + "").length + (withValueOf as any) * 2 + ((withValueOf as any) < k ? 1 : 0) + seed.indexOf(withToString as any);
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function webAssemblyExports(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = exported.triple(k) + exported.half(k) * 2;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

function hostFunctions(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = Buffer.from(seed[k % 8]).length + new TextEncoder().encode(seed[k % 8]).length + performance.now() * 0 + structuredClone({ a: k }).a + new URL("http://a/b?c=" + k).search.length + btoa(seed[k % 8]).length;
    i0 = (i0 + n) | 0; i1 = (i1 ^ (i0 + 1)) | 0; i2 = (i2 ^ (i1 + 2)) | 0; i3 = (i3 ^ (i2 + 3)) | 0; i4 = (i4 ^ (i3 + 4)) | 0; i5 = (i5 ^ (i4 + 5)) | 0; i6 = (i6 ^ (i5 + 6)) | 0;
    i7 = (i7 ^ (i6 + 7)) | 0; i8 = (i8 ^ (i7 + 8)) | 0; i9 = (i9 ^ (i8 + 9)) | 0; i10 = (i10 ^ (i9 + 10)) | 0; i11 = (i11 ^ (i10 + 11)) | 0; i12 = (i12 ^ (i11 + 12)) | 0; i13 = (i13 ^ (i12 + 13)) | 0;
    d0 = d0 * 0.5 + n; d1 = d1 * 0.5 + d0 + 0.125; d2 = d2 * 0.5 + d1 + 0.25; d3 = d3 * 0.5 + d2 + 0.375; d4 = d4 * 0.5 + d3 + 0.5; d5 = d5 * 0.5 + d4 + 0.625; d6 = d6 * 0.5 + d5 + 0.75; d7 = d7 * 0.5 + d6 + 0.875;
    d8 = d8 * 0.5 + d7 + 1.0; d9 = d9 * 0.5 + d8 + 1.125; d10 = d10 * 0.5 + d9 + 1.25; d11 = d11 * 0.5 + d10 + 1.375; d12 = d12 * 0.5 + d11 + 1.5; d13 = d13 * 0.5 + d12 + 1.625; d14 = d14 * 0.5 + d13 + 1.75; d15 = d15 * 0.5 + d14 + 1.875;
    d16 = d16 * 0.5 + d15 + 2.0; d17 = d17 * 0.5 + d16 + 2.125; d18 = d18 * 0.5 + d17 + 2.25; d19 = d19 * 0.5 + d18 + 2.375; d20 = d20 * 0.5 + d19 + 2.5; d21 = d21 * 0.5 + d20 + 2.625; d22 = d22 * 0.5 + d21 + 2.75; d23 = d23 * 0.5 + d22 + 2.875;
    d24 = d24 * 0.5 + d23 + 3.0; d25 = d25 * 0.5 + d24 + 3.125; d26 = d26 * 0.5 + d25 + 3.25; d27 = d27 * 0.5 + d26 + 3.375; d28 = d28 * 0.5 + d27 + 3.5; d29 = d29 * 0.5 + d28 + 3.625;
    r0 = r1; r1 = r2; r2 = r3; r3 = r4; r4 = r5; r5 = seed[(n & 0x7fffffff) % seed.length];
  }
  const integers = [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13].join();
  const doubles = [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29].join();
  return integers + " " + doubles + " " + r0 + "|" + r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5;
}

console.log("smallFunction", smallFunction(seed, 23));
console.log("tenIntegers", tenIntegers(seed, 23));
console.log("tenFractions", tenFractions(seed, 23));
console.log("argumentsOfMixedKinds", argumentsOfMixedKinds(seed, 23, [1, 2]));
console.log("calleeUsesEveryRegister", calleeUsesEveryRegister(seed, 23));
console.log("calleeUsesEveryFractionRegister", calleeUsesEveryFractionRegister(seed, 23));
console.log("tailCalls", tailCalls(seed, 23));
console.log("tailCallsWithMoreArguments", tailCallsWithMoreArguments(seed, 23));
console.log("tailCallsWithFewerArguments", tailCallsWithFewerArguments(seed, 23));
console.log("defaultParameters", defaultParameters(seed, 23));
console.log("twoResults", twoResults(seed, 23));
console.log("unknownCallee", unknownCallee(seed, 23, anyFunctions));
console.log("methodOfObject", methodOfObject(seed, 23));
console.log("callAndApply", callAndApply(seed, 23));
console.log("boundFunctions", boundFunctions(seed, 23));
console.log("tooFewAndTooManyArguments", tooFewAndTooManyArguments(seed, 23));
console.log("constructors", constructors(seed, 23));
console.log("mapAndFilter", mapAndFilter(seed, 23, [1, 2, 3, 4]));
console.log("forEachAndSome", forEachAndSome(seed, 23, [1, 2, 3, 4]));
console.log("sortWithComparator", sortWithComparator(seed, 23, [5, 3, 8, 1, 9, 2]));
console.log("replaceWithFunction", replaceWithFunction(seed, 23));
console.log("reviverAndReplacer", reviverAndReplacer(seed, 23));
console.log("arrayFromWithFunction", arrayFromWithFunction(seed, 23));
console.log("proxies", proxies(seed, 23, proxied));
console.log("conversionsThatRunCode", conversionsThatRunCode(seed, 23));
console.log("webAssemblyExports", webAssemblyExports(seed, 23));
console.log("hostFunctions", hostFunctions(seed, 23));
