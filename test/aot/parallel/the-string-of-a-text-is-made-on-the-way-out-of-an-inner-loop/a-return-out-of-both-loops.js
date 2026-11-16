// No try: the return leaves both loops from the inner one.
function spell(text) {
  let sum = 0, seen = "";
  for (let i = 0; i < text.length; i++) {
    seen += text[i];
    for (let j = 0; j < 3; j++) { if (i === 2 && j === 1) return seen + "!" + sum; sum += j * i; }
  }
  return [sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
