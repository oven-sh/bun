// The way to the handler leaves two loops of three: the outermost goes on behind the handler.
function spell(text) {
  let sum = 0, all = [];
  for (let turn = 0; turn < 2; turn++) {
    let seen = "";
    try {
      for (let i = 0; i < text.length; i++) {
        seen += text[i];
        for (let j = 0; j < 3; j++) { if (turn && i === 1 && j === 2) throw new Error("stop"); sum += j * i; }
      }
    } catch (error) { seen += "!"; }
    all.push(seen);
  }
  return [sum, all.join("+")].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
