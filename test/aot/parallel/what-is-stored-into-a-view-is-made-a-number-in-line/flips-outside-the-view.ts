function flip(perm: Int32Array, top: number): string { let k: number, flips = 0; while (!((k = perm[0]) == 0) && flips < top) { const k2 = (k + 1) >> 1; for (let i = 0; i < k2; i++) { const temp = perm[i]; perm[i] = perm[k - i]; perm[k - i] = temp; } flips++; } return flips + " " + perm.join() + "."; }
console.log(flip(Int32Array.of(2, 0, 1), 9), flip(Int32Array.of(5, 1, 2), 2), flip(new Int32Array(0), 2));
// 2 0,1,2. 1 0,0,0. 2 .
