let s = 0;
const D = [0, 0, 0, 0, 0, 0], O = { out: [0.5, 1, 2, 3, 4] };
function f(turns, l) { let n = 0; for (let k = 0; k < turns; k++) { const v = l[k & 3]; const q = () => { if (v > 1) { s += n & 1; return true; } return false; }; if (q()) { D[n & 1]++; } else { s += 2; } O.out[k % 5] = k * 0.5; n += k & 1; } return n; }
const L = [[0, 1, 2, 3], [0.5, 1.5, 2, 3], [1, 1, 1, 1]];
for (let z = 0; z < 6; z++) console.log(f(z & 1 ? 9 : 60, L[z % 3]), JSON.stringify([D, O, s]));
