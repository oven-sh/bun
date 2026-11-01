// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
const byName = new Map<string, number>(seed.map((word, at) => [word, at] as [string, number]));
const byNumber = new Map<number, number>([[1, 10], [2.5, 20], [-0, 30], [NaN, 40], [1e10, 50]]);
const keys: object[] = [{}, {}, {}];
const byObject = new Map<object, number>(keys.map((key, at) => [key, at] as [object, number]));
const names = new Set<string>(seed.slice(0, 5));
const weak = new WeakMap<object, number>(keys.map((key, at) => [key, at] as [object, number]));
const record: Record<string, number> = { alpha0: 1, beta1: 2, gamma2: 3, delta3: 4 };
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } get sum() { return this.x + this.y; } set both(v: number) { this.x = v; this.y = v; } norm() { return this.x * this.x + this.y * this.y; } }
class Point3 extends Point { z = 3; norm() { return super.norm() + this.z * this.z; } }
const points: Point[] = [new Point(1, 2), new Point3(3, 4), new Point(5, 6)];
const anything: any[] = [{ v: 1 }, { w: 0, v: 2 }, { v: 3.5, u: 1 }, Object.create({ v: 4 }), { get v() { return 5; } }, [6], "seven", 8];

function mapGetString(seed: string[], rounds: number, map: Map<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    const n = map.get(key) ?? -1;
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

function mapHasString(seed: string[], rounds: number, map: Map<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    const n = (map.has(key) ? 1 : 0) + (map.has(key + "x") ? 2 : 0);
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

function mapSetString(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const map = new Map<string, number>();
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    map.set(key + (k % 13), k);
    const n = map.size;
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

function mapDeleteString(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const map = new Map<string, number>();
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    map.set(key, k);
    const n = (map.delete(seed[(k + 3) % seed.length]) ? 1 : 0) + map.size;
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

function mapGetNumber(seed: string[], rounds: number, map: Map<number, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = (map.get(k % 3) ?? -1) + (map.get(k % 2 ? 2.5 : NaN) ?? -2) + (map.get(0) ?? -3);
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

function mapSetNumber(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const map = new Map<number, number>();
  for (let k = 0; k < rounds; k++) {
    map.set(k * 7, k);
    map.set(k + 0.5, k);
    const n = map.size;
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

function mapGetObject(seed: string[], rounds: number, map: Map<object, number>, keys: object[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = (map.get(keys[k % keys.length]) ?? -1) + (map.has(map) ? 1 : 0);
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

function setHas(seed: string[], rounds: number, set: Set<string>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    const n = set.has(key) ? 1 : 0;
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

function setAdd(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const set = new Set<unknown>();
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    set.add(key + (k % 11));
    set.add(k % 5);
    const n = set.size;
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

function weakMapGet(seed: string[], rounds: number, map: WeakMap<object, number>, keys: object[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = (map.get(keys[k % keys.length]) ?? -1) + (map.has(keys) ? 1 : 0);
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

function weakMapSet(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const map = new WeakMap<object, number>();
  for (let k = 0; k < rounds; k++) {
    const key = {};
    map.set(key, k);
    const n = map.get(key)!;
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

function mapIteration(seed: string[], rounds: number, map: Map<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    for (const [key, value] of map) n += key.length * value;
    for (const value of map.values()) n += value;
    map.forEach(value => { n += value; });
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

function readByComputedName(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    const n = object[key] ?? -1;
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

function storeByComputedName(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const object: Record<string, number> = {};
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    object[key + (k % 6)] = k;
    const n = Object.keys(object).length;
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

function nameTests(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    const n = (key in object ? 1 : 0) + (Object.hasOwn(object, key) ? 2 : 0) + (object.hasOwnProperty(key) ? 4 : 0);
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

function deletes(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  const object: Record<string, number> = {};
  for (let k = 0; k < rounds; k++) {
    const key = (seed[k % seed.length] + "!").slice(0, -1);
    object[key] = k;
    const n = (delete object[seed[(k + 2) % seed.length]] ? 1 : 0) + Object.keys(object).length;
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

function fieldsOfClasses(seed: string[], rounds: number, points: Point[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const point = points[k % points.length];
    point.x = point.x + 1;
    const n = point.x + point.y;
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

function methodsOfClasses(seed: string[], rounds: number, points: Point[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = points[k % points.length].norm();
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

function accessorsOfClasses(seed: string[], rounds: number, points: Point[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const point = points[k % points.length];
    point.both = k;
    const n = point.sum;
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

function readsOfManyShapes(seed: string[], rounds: number, values: any[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const value = values[k % values.length].v;
    const n = value === undefined ? -1 : value | 0;
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

function storesToManyShapes(seed: string[], rounds: number, values: any[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    values[k % values.length].v = k;
    values[k % values.length]["added" + (k % 3)] = k;
    const n = Object.keys(values[k % values.length]).length;
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

function instanceTests(seed: string[], rounds: number, values: any[], points: Point[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = (values[k % values.length] instanceof Point ? 1 : 0) + (points[k % points.length] instanceof Point3 ? 2 : 0) + (values[k % values.length] instanceof Array ? 4 : 0);
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

function typeNames(seed: string[], rounds: number, values: any[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = (typeof values[k % values.length]).length + (Array.isArray(values[k % values.length]) ? 1 : 0);
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

function objectCopies(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = Object.keys({ ...object, extra: k }).length + Object.entries(object).length + Object.values(Object.assign({}, object))[k % 4];
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

function serialization(seed: string[], rounds: number, object: Record<string, number>) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = JSON.stringify(object).length + JSON.parse('{"a":[1,2,' + k + ']}').a[2] + JSON.stringify([k, seed[k % 8], k + 0.5]).length;
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

console.log("mapGetString", mapGetString(seed, 23, byName));
console.log("mapHasString", mapHasString(seed, 23, byName));
console.log("mapSetString", mapSetString(seed, 23));
console.log("mapDeleteString", mapDeleteString(seed, 23));
console.log("mapGetNumber", mapGetNumber(seed, 23, byNumber));
console.log("mapSetNumber", mapSetNumber(seed, 23));
console.log("mapGetObject", mapGetObject(seed, 23, byObject, keys));
console.log("setHas", setHas(seed, 23, names));
console.log("setAdd", setAdd(seed, 23));
console.log("weakMapGet", weakMapGet(seed, 23, weak, keys));
console.log("weakMapSet", weakMapSet(seed, 23));
console.log("mapIteration", mapIteration(seed, 23, byName));
console.log("readByComputedName", readByComputedName(seed, 23, record));
console.log("storeByComputedName", storeByComputedName(seed, 23));
console.log("nameTests", nameTests(seed, 23, record));
console.log("deletes", deletes(seed, 23));
console.log("fieldsOfClasses", fieldsOfClasses(seed, 23, points));
console.log("methodsOfClasses", methodsOfClasses(seed, 23, points));
console.log("accessorsOfClasses", accessorsOfClasses(seed, 23, points));
console.log("readsOfManyShapes", readsOfManyShapes(seed, 23, anything));
console.log("storesToManyShapes", storesToManyShapes(seed, 23, anything.slice(0, 4)));
console.log("instanceTests", instanceTests(seed, 23, anything, points));
console.log("typeNames", typeNames(seed, 23, anything));
console.log("objectCopies", objectCopies(seed, 23, record));
console.log("serialization", serialization(seed, 23, record));
