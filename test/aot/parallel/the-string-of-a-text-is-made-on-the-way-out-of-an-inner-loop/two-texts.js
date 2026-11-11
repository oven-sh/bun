// Two strings are made on the way to the handler.
function spell(text) {
  let i = 0, sum = 0, seen = "", twice = "";
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      twice += text[i] + text[i];
      for (let j = 0; j < 3; j++) sum += j * i;
    }
  } catch (error) {}
  return [i, sum, seen, twice].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
