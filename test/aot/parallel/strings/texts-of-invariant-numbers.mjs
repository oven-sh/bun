// STATISTIC: NumberTextsHoisted >= 1
// The text of a number that no iteration changes is made in front of the loops: numbers, strings and nothing in one parameter, loops that run no iteration, appends and prepends.
function box(width, height, mark) {
  let text = "";
  for (let y = 0; y < height; y++) {
    let line = y % 2 ? ">" : "";
    for (let x = 0; x < width; x++) {
      if ((x + y) % 3 === 0) line += mark;
      else line = x + line;
    }
    text += line + (y < height - 1 ? "/" : "");
  }
  return text + " " + text.length;
}
function both(count, first, second) {
  let text = "<";
  for (let i = 0; i < count; i++) text = first + text + second;
  return text;
}
function changed(count, mark) {
  let text = "";
  for (let i = 0; i < count; i++) {
    text += mark;
    if (i === 2) mark = typeof mark === "number" ? mark / 2 : 0.75;
  }
  return text;
}
const said = [];
for (const [width, height] of [
  [5, 3],
  [3, 4],
  [0, 2],
  [12, 1],
  [2, 0],
])
  for (const mark of ["#", "", 1.5, -0, NaN, 1e21, 123456789, null, undefined, "中", 2 ** 53]) said.push(box(width, height, mark));
for (const count of [0, 1, 4])
  for (const mark of [0.5, "a", null, -1.25, undefined, Infinity]) said.push(both(count, mark, 2.5), both(count, "b", mark), changed(count, mark));
console.log(said.join("\n"));
