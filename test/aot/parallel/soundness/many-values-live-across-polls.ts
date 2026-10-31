// Every function keeps 14 integers, 30 doubles and 6 strings live across one kind of call in a loop: more than any register file holds, so every register that
// the call is said to keep holds one of them. The checksum shows a value that came back changed.
// Env: BUN_JSC_forceTrapAwareStackChecks=1
const seed = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((word, at) => word + at);
// Run with BUN_JSC_forceTrapAwareStackChecks=1 (the .json beside this file): every poll, in a loop and at the entry of a function, then takes its slow path.
function entered(value: number): number { let total = value; for (let at = 0; at < 3; at++) total += at * value; return total; }
function leaf(value: number): number { let total = value; while (total > 9) total = (total >> 1) + (total & 1); return total; }
function deep(depth: number): number { return depth ? deep(depth - 1) + depth : 0; }

function pollInTheLoopItself(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = k & 7;
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

function pollInInnerLoop(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = k;
    for (let j = 0; j < 300; j++) n = (n + (j ^ k)) | 0;
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

function pollInInnerLoopOfFractions(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let sum = k + 0.5;
    for (let j = 0; j < 300; j++) sum = sum * 0.75 + j;
    const n = sum | 0;
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

function pollAtEntryOfCallee(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = entered(k);
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

function pollInLoopOfLeafFunction(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = leaf(k * 1000 + 17);
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

function pollsAtEntriesOfRecursion(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    const n = deep(k);
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

function pollInLoopUnderHandler(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = k;
    try {
      for (let j = 0; j < 100; j++) { n = (n + j) | 0; if (j === 90 && k % 4 === 1) throw n; }
    } catch (caught) {
      n = (caught as number) + 1;
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

function pollInLoopOverArray(seed: string[], rounds: number, list: number[]) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    for (let j = 0; j < list.length; j++) n = (n + list[j]) | 0;
    for (const element of list) n ^= element;
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

function pollInLoopOverText(seed: string[], rounds: number) {
  let i0 = 1, i1 = 4, i2 = 7, i3 = 10, i4 = 13, i5 = 16, i6 = 19, i7 = 22, i8 = 25, i9 = 28, i10 = 31, i11 = 34, i12 = 37, i13 = 40;
  let d0 = 0.5, d1 = 1.5, d2 = 2.5, d3 = 3.5, d4 = 4.5, d5 = 5.5, d6 = 6.5, d7 = 7.5, d8 = 8.5, d9 = 9.5;
  let d10 = 10.5, d11 = 11.5, d12 = 12.5, d13 = 13.5, d14 = 14.5, d15 = 15.5, d16 = 16.5, d17 = 17.5, d18 = 18.5, d19 = 19.5;
  let d20 = 20.5, d21 = 21.5, d22 = 22.5, d23 = 23.5, d24 = 24.5, d25 = 25.5, d26 = 26.5, d27 = 27.5, d28 = 28.5, d29 = 29.5;
  let r0: string = seed[0], r1: string = seed[1], r2: string = seed[2], r3: string = seed[3], r4: string = seed[4], r5: string = seed[5];
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    const text = seed[k % 8] + seed[(k + 1) % 8];
    for (let j = 0; j < text.length; j++) n = (n * 31 + text.charCodeAt(j)) | 0;
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

console.log("pollInTheLoopItself", pollInTheLoopItself(seed, 3000));
console.log("pollInInnerLoop", pollInInnerLoop(seed, 23));
console.log("pollInInnerLoopOfFractions", pollInInnerLoopOfFractions(seed, 23));
console.log("pollAtEntryOfCallee", pollAtEntryOfCallee(seed, 23));
console.log("pollInLoopOfLeafFunction", pollInLoopOfLeafFunction(seed, 23));
console.log("pollsAtEntriesOfRecursion", pollsAtEntriesOfRecursion(seed, 23));
console.log("pollInLoopUnderHandler", pollInLoopUnderHandler(seed, 23));
console.log("pollInLoopOverArray", pollInLoopOverArray(seed, 23, Array.from({ length: 200 }, (_, at) => at * 3)));
console.log("pollInLoopOverText", pollInLoopOverText(seed, 23));
