// STATISTIC: ElementsCarriedAroundLoops >= 1
// The next iteration finds in l[j] what this one has read as l[j + 1], or what it has stored there.
function sort(l: number[]): number[] { for (let i = 0; i < l.length; i++) for (let j = 0; j < l.length - 1 - i; j++) if (l[j]! > l[j + 1]!) { const t = l[j]!; l[j] = l[j + 1]!; l[j + 1] = t; } return l; }
function once(l: number[]): number[] { for (let j = 0; j < l.length - 1; j++) if (l[j]! > l[j + 1]!) { const t = l[j]!; l[j] = l[j + 1]!; l[j + 1] = t; } return l; }
function rising(l: number[]): number[] { for (let j = 1; j < l.length; j++) if (l[j]! < l[j - 1]!) l[j] = l[j - 1]!; return l; }
function falling(l: number[]): number[] { for (let j = l.length - 1; j > 0; j--) if (l[j - 1]! < l[j]!) l[j - 1] = l[j]! + 1; return l; }
function change(k: number): void {
  console.log(k, sort([5, 3, 9, 1, 7, 2, 8, k & 7]).join(), once([5, 3, 9, 1, 7, 2, 8, k & 7]).join(), rising([5, 3, 9, 1, 7, 2, 8, k & 7]).join(), falling([5, 3, 9, 1, 7, 2, 8, k & 7]).join());
  console.log(sort([k]).join(), once([]).join("none"), rising([k, 1]).join(), falling([1, k, 2147483647]).join());
}
for (let k = 0; k < 12; k++) change(k);
function holes(k: number): void {
  const l = [5, 3, 9, 1, 7, 2, 8, 4];
  delete l[k];
  once(l);
  console.log(k, Object.keys(l).join(), l.join());
  const m = [5, 3, 9, 1, 7, 2, 8, 4];
  m[k] = k / 4;
  once(m);
  console.log(m.join());
}
for (let k = 0; k < 8; k++) holes(k);
