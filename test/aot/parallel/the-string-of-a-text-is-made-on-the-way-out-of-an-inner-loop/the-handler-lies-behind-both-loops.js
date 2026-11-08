// What may throw in the inner loop leads to the handler behind both loops, which is handed the text: the string is made on the way there.
function spell(text) {
  let i = 0, sum = 0, seen = "";
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 3; j++) sum += j * i;
    }
  } catch (error) {}
  return [i, sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
