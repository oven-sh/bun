// What the inner loop has stored is read behind the handler.
function spell(text) {
  const box = { n: 1 };
  let i = 0, sum = 0, seen = "";
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 3; j++) { sum += j * box.n; if (i === 2 && j === 1) { box.n = 5; throw new Error("stop"); } }
    }
  } catch (error) { seen += box.n; }
  return [i, sum, seen, box.n].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
