const unseen = (0, eval)("(x) => x");
function gather(count) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = new URLSearchParams(line + "=1&k0=2").get(line);
    const has = new URLSearchParams("k0=1&k0k1=2").has(line);
    line += "k" + i;
    kept.push(got, has);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(4));
console.log(last);
console.log(gather(unseen(6)));
