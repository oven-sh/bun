function times(list: number[]): string { let t = 0, c = 0; for (let i = 0; i < list.length; i++) { const v = list[i]! * 1; t += v; if (v > 2) c++; } return t + " " + c; }
function less(list: number[]): string { let t = 0, c = 0; for (let i = 0; i < list.length; i++) { const v = list[i]! - 0; t += v; if (v === v) c++; } return t + " " + c; }
function over(list: number[]): string { let c = 0, u = 0; for (let i = 0; i < list.length; i++) { const v = list[i]! / 1; if (v !== v) u++; else c += v; } return c + " " + u; }
for (const n of [4, 9, 20]) for (const hole of [-1, 0, 3, 8]) { if (hole >= n) continue;
  const list: number[] = new Array(n); for (let i = 0; i < n; i++) if (i !== hole) list[i] = i * 2 - 3;
  console.log(n, hole, times(list), less(list), over(list));
}
