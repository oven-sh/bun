const unseen = (0, eval)("(x) => x");
const hidden = unseen(function (a, b) { return a + ":" + b; });
function gather(count) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = hidden.apply(null, [line, i]);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(4));
console.log(last);
console.log(gather(unseen(0)));
console.log(gather(unseen(7)));
