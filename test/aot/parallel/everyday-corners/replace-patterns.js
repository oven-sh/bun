// Replace patterns: compiled answers as plain.
console.log(
  [
    "abc".replace("b", "[$&]"),
    "abc".replace("b", "$`|$'"),
    "abc".replace(/(b)/, "$1$1$2"),
    "abc".replace(/(?<x>b)/, "$<x>!"),
    "aaa".replace("a", "$$"),
    "abc".replace(/b/, (m, i, s) => m + i + s),
    "aaa".replaceAll("a", (m, i) => i),
    "abc".replace("", "-"),
    "abc".replace(/x*/g, "-"),
  ].join(" "),
);
