// No try: the break leaves both loops from the inner one, and the string is made on that edge.
function spell(text) {
  let i = 0, sum = 0, seen = "";
  outer: for (i = 0; i < text.length; i++) {
    seen += text[i];
    for (let j = 0; j < 3; j++) { if (i === 2 && j === 1) break outer; sum += j * i; }
  }
  return [i, sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
