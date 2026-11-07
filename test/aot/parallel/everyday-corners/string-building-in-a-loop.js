// String building in a loop: compiled answers as plain.
function build(n, piece) {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += piece;
    if (i === 2) s = s + i;
  }
  return s.length + ":" + s.slice(-4);
}
console.log(build(5, "ab"), build(5, "é"), build(5, "中"), build(0, "x"), build(4, 1), build(4, null));
