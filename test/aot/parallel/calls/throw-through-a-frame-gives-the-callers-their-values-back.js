// a throw passes through a function that keeps one value across its calls; a caller further up catches, and the caller above that reads what it has kept across the whole of it
const hidden = JSON.parse('{"yes": 1, "no": 0}');
function thrower(value) {
  if (value) throw new Error("thrown");
  return 1;
}
function middle(value, kept) {
  thrower(value);
  thrower(0);
  return kept + kept;
}
function outer(value) {
  try {
    return String(middle(value, 3));
  } catch (error) {
    return error.message;
  }
}
function deed(value, kept) {
  const result = outer(value);
  thrower(0);
  return String(kept) + String(kept) + result;
}
console.log(deed(hidden.no, 5));
console.log(deed(hidden.yes, 5));
for (let turn = 0; turn < 300; turn++) {
  if (deed(turn & 1, turn) !== String(turn) + String(turn) + (turn & 1 ? "thrown" : "6")) console.log("differs at " + String(turn));
}
console.log(deed(hidden.yes, 7));
