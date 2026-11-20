// The handler lies in the loop of the text: it goes on with the builder.
function spell(text) {
  let i = 0, sum = 0, seen = "";
  for (i = 0; i < text.length; i++) {
    try {
      seen += text[i];
      for (let j = 0; j < 3; j++) sum += j * i;
    } catch (error) { seen += "!"; }
  }
  return [i, sum, seen].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
