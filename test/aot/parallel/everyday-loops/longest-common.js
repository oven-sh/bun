// A table of two texts filled by two loops and walked back
function common(a, b) {
  const table = [];
  for (let i = 0; i <= a.length; i++) {
    table.push([]);
    for (let k = 0; k <= b.length; k++) {
      if (!i || !k) table[i].push(0);
      else if (a[i - 1] === b[k - 1]) table[i].push(table[i - 1][k - 1] + 1);
      else table[i].push(Math.max(table[i - 1][k], table[i][k - 1]));
    }
  }
  const out = [];
  for (let i = a.length, k = b.length; i && k; ) {
    if (a[i - 1] === b[k - 1]) out.unshift(a[(k--, --i)]);
    else if (table[i - 1][k] >= table[i][k - 1]) i--;
    else k--;
  }
  return out.join("") + " " + table[a.length][b.length];
}
console.log(common("abcbdab", "bdcaba"));
console.log(common([1, 2.5, "x", 4], [2.5, 3, "x"]));
console.log(common("", "a") + "|", common("same", "same"));
