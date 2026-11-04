const unseen = (0, eval)("(x) => x");
function gather(count, base) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = { ...base, text: line, more: (line += "g"), n: i };
    const both = { ...base, ...line };
    line += "k" + i;
    kept.push(got.text, got.more, got.n, got.z, Object.keys(both).length);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(3), unseen({ z: 1 }));
console.log(last);
console.log(gather(unseen(5), unseen({ z: 2, text: "t" })));
