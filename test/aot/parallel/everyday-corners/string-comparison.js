// String comparison: compiled answers as plain.
console.log(
  [
    "b" < "a",
    "a" < "B",
    "10" < "9",
    "10" < 9,
    "a" < "aa",
    "" < "a",
    "é" < "z",
    "😀" < "￿",
    "a".localeCompare("b"),
    ["b", "a", "C"].sort().join(),
    "A" == "a",
    "1" == 1,
    "1" === 1,
  ].join(),
);
