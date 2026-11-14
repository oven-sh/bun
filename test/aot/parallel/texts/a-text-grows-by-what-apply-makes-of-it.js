const unseen = (0, eval)("(x) => x");
const hidden = unseen(function (a, b) { return "<" + a.length + ":" + b + ">"; });
function gather(count) {
  let line = "";
  for (let i = 0; i < count; i++) {
    if (i & 1) line += hidden.apply(null, [line, i]);
    line += "k" + i;
  }
  return line;
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(5));
console.log(last);
console.log(gather(unseen(0)) === "", gather(unseen(8)));
