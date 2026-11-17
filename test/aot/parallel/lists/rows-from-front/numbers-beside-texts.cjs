function lcs(a, b) {
  const m = a.length, n = b.length, c = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) c[i][j] = a[i - 1] === b[j - 1] ? c[i - 1][j - 1] + 1 : Math.max(c[i - 1][j], c[i][j - 1]);
  return c.map(row => row.join()).join(" ");
}
const numbers = [5, 3, 8, 1, 9, 2], halves = [0.5, 3, 8, 1.5, 9, 2], texts = "abcabd".split(""), mixed = [1, "a", 2.5, null, undefined, NaN], holes = [1, , 3, , 5, -0];
for (let round = 0; round < 3; round++) for (const a of [texts, numbers, halves, mixed, holes]) for (const b of [numbers, texts, mixed, halves, holes, [], a]) console.log(lcs(a, b));
