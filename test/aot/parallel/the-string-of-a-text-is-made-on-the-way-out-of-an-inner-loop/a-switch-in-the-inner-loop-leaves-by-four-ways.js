function spell(text, marks) {
  let sum = 0, seen = "";
  outer: for (let i = 0; i < text.length; i++) {
    seen += text[i];
    for (let j = 0; j < 3; j++) {
      switch (marks[i * 3 + j]) {
        case 1: break outer;
        case 2: continue outer;
        case 3: return "returned " + sum;
        case 4: throw new RangeError("thrown " + sum);
        default: sum += j * i;
      }
    }
    seen += "-";
  }
  return [sum, seen].join("|");
}
function tell(place, mark) {
  const marks = new Array(12).fill(0);
  marks[place] = mark;
  try { return spell("abcd", marks); } catch (error) { return error.name + ": " + error.message; }
}
let shown = "";
for (let round = 0; round < 50; round++) shown = [tell(0, 0), tell(7, 1), tell(4, 2), tell(5, 3), tell(8, 4)].join(" || ");
console.log(shown);
