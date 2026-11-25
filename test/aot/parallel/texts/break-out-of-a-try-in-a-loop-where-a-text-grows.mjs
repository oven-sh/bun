const unseen = (0, eval)("(x) => x");
const boom = (0, eval)("var armed = 1; (t) => { if (armed-- > 0) throw new Error('behind the loop ' + t.length); }");
function build(n) {
  let s = "";
  let i = 0;
  let hits = 0;
  for (;;) {
    try {
      s += "k" + i + ",";
      i++;
      if (i >= n) break;
    } catch (e) {
      hits++;
    }
  }
  boom(s);
  return s + "|" + hits;
}
try {
  console.log("returned " + build(unseen(3) | 0));
} catch (e) {
  console.log("outer caught: " + e.message);
}
