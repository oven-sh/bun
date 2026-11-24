const makers = [() => JSON.parse("[7,4,2,3,0,9,12,5,1,8]"), () => [5, 3, 9, 1, 7, 2], () => { const list = []; for (let k = 0; k < 14; k++) list.push((k * 5) % 14); return list; }, () => [0.5, 2.5, 1.5, 3.5, 9.25, 4], () => [3, "t", 1, null, 2.5, true, 7], () => [3, , 1, 5, , 2], () => [2147483647, -2147483648, 0, 5, -1], () => new Int32Array([5, 3, 9, 1, 7, 2]), () => new Float64Array([5.5, 3, 9, 1, 7, 2]), () => new Uint8Array([5, 3, 9, 1])];
function exchange(L, a, b) { const t = L[a]; L[a] = L[b]; L[b] = t; }
class Holder { constructor(list) { this.list = list; } turn() { const L = this.list; for (let a = 0; a < L.length - 1; a++) [L[a], L[a + 1]] = [L[a + 1], L[a]]; } sort() { for (let j = 0; j < this.list.length; j++) for (let a = 0; a < this.list.length - 1; a++) if (this.list[a] > this.list[a + 1]) { const t = this.list[a]; this.list[a] = this.list[a + 1]; this.list[a + 1] = t; } } }
const forms = [
  L => { let low = 0, high = L.length - 1; while (low < high) { [L[low], L[high]] = [L[high], L[low]]; low++; high--; } },
  L => { for (let a = 0, b = L.length - 1; a < b; a++, b--) { const t = L[a]; L[a] = L[b]; L[b] = t; } },
  L => { let a = 0, b = L.length - 1; do { [L[a], L[b]] = [L[b], L[a]]; a++; b--; } while (a < b); },
  L => { for (let j = 1; j < L.length; j++) for (let a = j - 1; a >= 0 && L[a] > L[a + 1]; a--) [L[a], L[a + 1]] = [L[a + 1], L[a]]; },
  L => { for (let a = 0; a < L.length - 1; a++) exchange(L, a, a + 1); },
  L => { let seed = 7; for (let a = L.length - 1; a > 0; a--) { seed = (seed * 31 + 11) % 1009; const b = seed % (a + 1); let t = L[a]; L[a] = L[b]; L[b] = t; } },
  L => { for (let a = 0; a + 2 < L.length; a++) [L[a], L[a + 1], L[a + 2]] = [L[a + 1], L[a + 2], L[a]]; },
  L => { for (let a = 0, b = L.length - 1; a < b; a++, b--) { L[a] ^= L[b]; L[b] ^= L[a]; L[a] ^= L[b]; } },
  L => { for (let a = 0, b = L.length - 1; a < b; a++, b--) { const x = L[a]; L[a] = x + x; L[b] = x; } },
  L => { for (let a = 0, b = L.length - 1; a < b; a++, b--) [L[a], L[b]] = [L[b] + 1, L[a] - 1]; },
  L => new Holder(L).turn(),
  L => new Holder(L).sort(),
  L => { const go = (a, b) => { if (a < b) { [L[a], L[b]] = [L[b], L[a]]; go(a + 1, b - 1); } }; go(0, L.length - 1); },
];
const told = L => Array.from(L, (x, k) => (k in L ? String(x) : "hole")).join();
for (const make of makers) for (const form of forms) { const L = make(); for (let t = 0; t < 3; t++) form(L); console.log(told(L)); }
