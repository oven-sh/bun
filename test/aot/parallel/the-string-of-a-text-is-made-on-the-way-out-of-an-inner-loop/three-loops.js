// The way to the handler leaves three loops.
function spell(text) {
  let i = 0, sum = 0, seen = "";
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) sum += j * k + i;
    }
  } catch (error) {}
  return [i, sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
