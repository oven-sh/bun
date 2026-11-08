const unseen = (0, eval)("(x) => x");
function gather(count, holder) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = holder.run.apply(holder, [i, line, line]);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
const given = unseen({ mark: "!", run(a, b, c) { return this.mark + a + b + c.length; } });
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(4), given);
console.log(last);
console.log(gather(unseen(6), given));
