// Switch true: compiled answers as plain.
function s(x) {
  switch (true) {
    case x < 0:
      return "neg";
    case x === 0:
      return "zero";
    case x > 0:
      return "pos";
    default:
      return "nan";
  }
}
for (const v of [-1, 0, 1, NaN, "2", null, undefined]) console.log(s(v));
