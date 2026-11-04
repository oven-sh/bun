// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
class Failure extends Error { code: number; constructor(code: number) { super("failure " + code); this.code = code; } }
function fails(code: number): number { if (code >= 0) throw new Failure(code); return code; }
function failsDeep(code: number, depth: number): number { if (!depth) return fails(code); const a = code + depth, b = a * 2, c = b ^ depth; return failsDeep(code, depth - 1) + a + b + c; }
function sometimes(code: number): number { if (code % 3 === 0) throw code; return code; }
function overflow(depth: number): number { return overflow(depth + 1) + 1; }
const nothing: any = null, missing: any = undefined, notCallable: any = { f: 1 };
const trapped: unknown[] = ["x", "y"]; Object.defineProperty(trapped, 70000, { get() { throw new Failure(7); }, configurable: true, enumerable: true });
const explosive = { valueOf(): number { throw new Failure(9); } };
const frozen = Object.freeze({ a: 1 }) as { a: number };
function searchesDeeper(list: string[], text: string, depth: number): number { return (list.includes(text) ? 1 : 0) + list.indexOf(text) + searchesDeeper(list, text, depth + 1); }
function searchesBelow(levels: number, list: string[], text: string): number { return levels ? searchesBelow(levels - 1, list, text) + 1 : searchesDeeper(list, text, 0); }

function compiledCalleeThrows(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = fails(k);
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function calleeOfCalleeThrows(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = failsDeep(k, 1 + (k % 6));
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function calleeThrowsSometimes(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = sometimes(k);
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function readOfNull(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = (k % 2 ? nothing : missing).field;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function callOfSomethingNotCallable(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = k % 2 ? notCallable.f() : notCallable.g();
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function invalidArrayLength(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = new Array(-1 - k).length;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function invalidText(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = JSON.parse("{" + k).a;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function mixedBigInteger(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = Number((BigInt(k) as any) + (k as any));
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function storeToFrozenObject(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      frozen.a = k; n = 0;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function useBeforeInitialization(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      const readLate = () => late; n = readLate() + k; let late = 1;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function searchMeetsThrowingGetter(seed: string[], rounds: number, list: unknown[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = k % 6 ? -3 : list.indexOf("z");
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function includesMeetsThrowingGetter(seed: string[], rounds: number, list: unknown[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = k % 6 ? -3 : list.includes("z") ? 1 : 0;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function startIndexThrows(seed: string[], rounds: number, list: unknown[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = list.indexOf("y", explosive as unknown as number) + (list.includes("y", explosive as unknown as number) ? 1 : 0);
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function conversionThrows(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = Math.floor(explosive as unknown as number) + k;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function callbackThrows(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = list.map(value => fails(value + k)).length;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function comparatorThrows(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      n = list.slice().sort((a, b) => fails(a + b + k)).length;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function iteratorThrows(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      for (const value of { [Symbol.iterator]() { return { next() { return fails(k) as unknown as IteratorResult<number>; } }; } }) n += value;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function stackOverflows(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < 3; k++) {
    let n = -1;
    try {
      n = overflow(0);
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function searchOverflowsTheStack(seed: string[], rounds: number, list: string[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < 7; k++) {
    let n = -1;
    try {
      n = searchesBelow(k, list, seed[k % 8]);
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

function finallyRuns(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      try {
        n = fails(k);
      } finally {
        n = -2;
      }
    } catch (caught) {
      n += (caught as Failure).code;
    }
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

function rethrown(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      try {
        n = failsDeep(k, 2);
      } catch (caught) {
        throw new Failure((caught as Failure).code + 1);
      }
    } catch (caught) {
      n = (caught as Failure).code;
    }
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

function throwInTheSameFunction(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = -1;
    try {
      if (k % 2) throw new Failure(k); n = k;
    } catch (caught) {
      n = caught instanceof Failure ? caught.code : caught instanceof Error ? caught.name.length : (caught as number) | 0;
    }
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

console.log("compiledCalleeThrows", compiledCalleeThrows(seed, 23));
console.log("calleeOfCalleeThrows", calleeOfCalleeThrows(seed, 23));
console.log("calleeThrowsSometimes", calleeThrowsSometimes(seed, 23));
console.log("readOfNull", readOfNull(seed, 23));
console.log("callOfSomethingNotCallable", callOfSomethingNotCallable(seed, 23));
console.log("invalidArrayLength", invalidArrayLength(seed, 23));
console.log("invalidText", invalidText(seed, 23));
console.log("mixedBigInteger", mixedBigInteger(seed, 23));
console.log("storeToFrozenObject", storeToFrozenObject(seed, 23));
console.log("useBeforeInitialization", useBeforeInitialization(seed, 23));
console.log("searchMeetsThrowingGetter", searchMeetsThrowingGetter(seed, 23, trapped));
console.log("includesMeetsThrowingGetter", includesMeetsThrowingGetter(seed, 23, trapped));
console.log("startIndexThrows", startIndexThrows(seed, 23, ["x", "y"]));
console.log("conversionThrows", conversionThrows(seed, 23));
console.log("callbackThrows", callbackThrows(seed, 23, [1, 2, 3]));
console.log("comparatorThrows", comparatorThrows(seed, 23, [3, 1, 2]));
console.log("iteratorThrows", iteratorThrows(seed, 23));
console.log("stackOverflows", stackOverflows(seed, 23));
console.log("searchOverflowsTheStack", searchOverflowsTheStack(seed, 23, ["one", "two", "three"].map(word => word + "")));
console.log("finallyRuns", finallyRuns(seed, 23));
console.log("rethrown", rethrown(seed, 23));
console.log("throwInTheSameFunction", throwInTheSameFunction(seed, 23));
