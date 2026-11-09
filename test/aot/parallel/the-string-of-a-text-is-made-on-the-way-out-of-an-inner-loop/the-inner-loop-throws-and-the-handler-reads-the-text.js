// The throw is a jump to the handler: the string is made on an ordinary edge out of both loops.
function spell(text) {
  let i = 0, sum = 0, seen = "";
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 3; j++) { if (i === 2 && j === 1) throw new Error("stop"); sum += j * i; }
    }
  } catch (error) { seen += "/" + error.message; }
  return [i, sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
