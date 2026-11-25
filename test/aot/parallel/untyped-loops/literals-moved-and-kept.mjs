// Literals of whole numbers whose elements a loop moves and which go to functions that see lists of others: kept, changed elsewhere to texts and fractions, joined, sorted again.
// STATISTIC: ArrayLiteralsAllocatedForLoops >= 2
const kept = [];
function first(l) { return l[0]; }
function spoil(l, k) { if (k === 2) l[1] = "t"; if (k === 3) l[0] = 0.5; if (k === 4) delete l[2]; if (k === 5) l.push({ k }); return l.length; }
function sorted(turns) { let n = 0, all = ""; for (let k = 0; k < turns; k++) { const l = [5, 3, 9, 1, 7, 2, 8, k & 7]; for (let i = 1; i < l.length; i++) { const x = l[i]; let j = i - 1; while (j >= 0 && l[j] > x) { l[j + 1] = l[j]; j--; } l[j + 1] = x; } n += first(l); kept.push(l); all += l.join("") + " "; } return all + n; }
function reversed(turns) { let all = ""; for (let k = 0; k < turns; k++) { const l = [k & 3, 4, 7, 9, 2147483647]; all += spoil(l, k); for (let i = 0, j = l.length - 1; i < j; i++, j--) { const t = l[i]; l[i] = l[j]; l[j] = t; } all += l.map(v => typeof v === "object" ? "o" : String(v)).join() + (2 in l) + " "; } return all; }
console.log(first(["a"]), first([0.5]), first([{}]) !== undefined);
console.log(sorted(8));
kept[0][0] = "z"; kept[1][1] = 1.5; kept[2].push(null); kept[3][20] = 4;
console.log(kept.map(l => l.length + ":" + l.join("_")).join(" "), sorted(3));
console.log(reversed(9));
