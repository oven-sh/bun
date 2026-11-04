// The list is written behind the growth.
const unseen = (0, eval)("(x) => x");
const measure = unseen(function (text) { return text.length; });
function run(count) {
  let line = "";
  let total = 0;
  for (let i = 0; i < count; i++) {
    line += "k" + i;
    total += measure.apply(null, [line]);
  }
  return total + ":" + line.length;
}
console.log(run(300));
