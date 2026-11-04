// The list holds nothing of the text: it is still made again where the call as written stands.
const unseen = (0, eval)("(x) => x");
const hidden = unseen(function (a, b) { return a + ":" + b; });
function gather(count, tail) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = hidden.apply(null, [tail, i]);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(4), unseen("-"));
console.log(last);
