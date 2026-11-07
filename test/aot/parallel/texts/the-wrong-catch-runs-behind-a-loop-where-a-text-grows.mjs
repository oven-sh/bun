const unseen = (0, eval)("(x) => x");
const boom = (0, eval)("(t) => { throw new Error('behind the loop ' + t.length); }");
function build(n) {
  let s = "";
  let i = 0;
  let inner = 0;
  try {
    for (;;) {
      try {
        s += "k" + i + ",";
        i++;
        if (i >= n) break;
      } catch (e) {
        inner++;
        if (inner > 2) return "inner caught it " + inner + " times";
      }
    }
    boom(s);
  } catch (e) {
    return "outer caught: " + e.message + "|" + inner;
  }
  return s;
}
console.log(build(unseen(3) | 0));
