// Alone: what a list is said to hold is a fact about the whole program.
// Whole numbers out of a row of fractions that has got a label are pushed and written into literals behind a test that they are int32s.
const fractions = [9.5, 0.5, 2, 3];
const row = fractions.slice(0);
row.push("label");
const ends = list => list[0] + " " + list[list.length - 1] + " " + list.indexOf(2);
function pushed(x) {
  const list = [1];
  if (typeof x === "number" && (x | 0) === x) list.push(x);
  return ends(list);
}
function pushedTwice(x) {
  const list = [1];
  if (typeof x === "number" && (x | 0) === x) list.push(x, x);
  return ends(list);
}
function inLiteral(x) {
  let list = [1];
  if (typeof x === "number" && x === (x | 0)) list = [1, x];
  return ends(list);
}
function inLiteralOfThree(x) {
  if (typeof x !== "number") return "no number";
  let list = [1];
  if ((x | 0) === x) list = [x, x, x];
  return ends(list);
}
for (const x of row)
  console.log(pushed(x) + " | " + pushedTwice(x) + " | " + inLiteral(x) + " | " + inLiteralOfThree(x));
