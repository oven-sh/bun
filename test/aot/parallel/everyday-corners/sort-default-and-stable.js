// Sort default and stable: compiled answers as plain.
console.log(
  [10, 9, 1, undefined, , "b", null, -1].sort().map(String).join(),
  [3, 1, 2].sort((a, b) => b - a).join(),
  [
    { k: 1, v: "a" },
    { k: 0, v: "b" },
    { k: 1, v: "c" },
    { k: 0, v: "d" },
  ]
    .sort((x, y) => x.k - y.k)
    .map(o => o.v)
    .join(""),
  [1, 2, 3].sort(() => 0).join(),
);
