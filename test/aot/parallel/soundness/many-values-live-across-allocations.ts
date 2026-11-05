// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
class Pair { first: number; second: string; constructor(first: number, second: string) { this.first = first; this.second = second; } }
class Wide { a = 1; b = 2.5; c = "c"; d = [1]; e = { f: 1 }; g = null; h = undefined; i = true; j = 10; k = 11; l = 12; m = 13; }
class Derived extends Pair { third = [this.first]; constructor(first: number) { super(first, "derived"); } }
function collect() { if (typeof Bun !== "undefined") Bun.gc(true); }
function* count(limit: number) { for (let at = 0; at < limit; at++) yield at; }
function rest(...values: number[]) { return values.length; }
function all() { return arguments.length; }
const collecting: unknown[] = ["x", "y"]; Object.defineProperty(collecting, 3000, { get() { collect(); return "z"; }, configurable: true, enumerable: true });

function objectLiterals(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = { x: k, y: k + 0.5, z: seed[k % 8] };
    kept[k % 4] = made;
    const n = made.x + made.z.length;
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

function arrayLiterals(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = [k, k + 1, k + 2];
    kept[k % 4] = made;
    const n = made[1];
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

function instances(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = new Pair(k, seed[k % 8]);
    kept[k % 4] = made;
    const n = made.first + made.second.length;
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

function wideInstances(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = new Wide();
    kept[k % 4] = made;
    const n = made.j + made.d.length + k;
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

function derivedInstances(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = new Derived(k);
    kept[k % 4] = made;
    const n = made.third[0] + made.second.length;
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

function closures(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: (() => number)[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = () => k + r0.length;
    kept[k % 4] = made;
    const n = kept[(k * 3) % Math.min(k + 1, 4)]();
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

function arraysOfGivenLength(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const made = new Array<number>(k % 40);
    made[0] = k;
    const n = made.length + new Array(k, 1).length + Array.of(k).length;
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

function largeArrays(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const made = new Array<number>(20000 + k).fill(k);
    const n = made[19999] + made.length;
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

function collections(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = new Map([[k, k]]).size + new Set([k, k, 1]).size + (new WeakSet().has(seed) ? 1 : 0);
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

function buffers(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = new Float64Array(k % 9).length + new Uint8Array([k, 2]).length + new ArrayBuffer(k).byteLength + new Uint8Array(5000)[k];
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

function ropes(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  let text = "";
  for (let k = 0; k < rounds; k++) {
    text = text + seed[k % 8] + k;
    const n = text.length + text.charCodeAt(text.length >> 1);
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

function spreads(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = [...list, k].length + rest(...list, k) + Math.max(...list, k % 5) + Object.keys({ ...list }).length;
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

function restAndArguments(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = rest(k, 1, 2) + rest() + (all as (...values: unknown[]) => number)(k, 2);
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

function errors(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const made = new Error("e" + k);
    const n = made.message.length + (made.stack ? 1 : 0) + new TypeError().name.length + new RangeError("r", { cause: k }).message.length;
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

function symbolsAndWrappers(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = Symbol(seed[k % 8]).description!.length + Object(k).valueOf() + Object(seed[0]).length + new Number(k + 0.5).valueOf() | 0;
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

function generatorObjects(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    for (const value of count(k % 5)) n += value;
    n += [...count(3)].length;
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

function promises(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = Promise.resolve(k);
    kept[k % 4] = made.then(value => value + 1);
    const n = kept.length;
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

function regularExpressionObjects(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const made = new RegExp(seed[k % 8][0], "g");
    const n = made.source.length + /x/y.flags.length + (made.test(seed[k % 8]) ? made.lastIndex : -1);
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

function searchRunsTheCollector(seed: string[], rounds: number, list: unknown[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const fresh = { x: k, text: seed[k % 8] + k };
    const other = [k, k + 1], third = { inner: [seed[k % 8]] };
    const at = k % 6 ? -2 : list.indexOf("zz") + (list.includes("zz") ? 1 : 0);
    const n = at + fresh.x + fresh.text.length + other[1] + third.inner[0].length;
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

function collections1(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < 4; k++) {
    collect();
    const n = k;
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

function allocationsBetweenCollections(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const kept: unknown[] = [];
  for (let k = 0; k < rounds; k++) {
    const made = { x: k, list: [k, seed[k % 8]], inner: { y: k + 0.5 } };
    if (k % 8 === 7) collect();
    kept[k % 4] = made;
    const n = (kept[(k * 3) % Math.min(k + 1, 4)] as typeof made).list.length + made.x;
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

console.log("objectLiterals", objectLiterals(seed, 23));
console.log("arrayLiterals", arrayLiterals(seed, 23));
console.log("instances", instances(seed, 23));
console.log("wideInstances", wideInstances(seed, 23));
console.log("derivedInstances", derivedInstances(seed, 23));
console.log("closures", closures(seed, 23));
console.log("arraysOfGivenLength", arraysOfGivenLength(seed, 23));
console.log("largeArrays", largeArrays(seed, 23));
console.log("collections", collections(seed, 23));
console.log("buffers", buffers(seed, 23));
console.log("ropes", ropes(seed, 23));
console.log("spreads", spreads(seed, 23, [1, 2, 3]));
console.log("restAndArguments", restAndArguments(seed, 23));
console.log("errors", errors(seed, 23));
console.log("symbolsAndWrappers", symbolsAndWrappers(seed, 23));
console.log("generatorObjects", generatorObjects(seed, 23));
console.log("promises", promises(seed, 23));
console.log("regularExpressionObjects", regularExpressionObjects(seed, 23));
console.log("searchRunsTheCollector", searchRunsTheCollector(seed, 23, collecting));
console.log("collections1", collections1(seed, 23));
console.log("allocationsBetweenCollections", allocationsBetweenCollections(seed, 23));
