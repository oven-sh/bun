// `for (let k = 0; k < arguments.length; k++) total += arguments[k];`: once the function is inlined, its further arguments are a list that only the loop reads.
// The first loop calls with numbers: neither the arguments object nor that list is made. Then come calls whose arguments are of other kinds, too few, too many, or changed in the loop.
// COUNT: allCells <= 30000
function total() {
  let sum = 0;
  for (let k = 0; k < arguments.length; k++) sum += arguments[k];
  return sum;
}
function totalAfterFirst(first) {
  let sum = first;
  for (let k = 1; k < arguments.length; k++) sum += arguments[k];
  return sum;
}
function largest() {
  let best = -Infinity;
  for (let k = 0; k < arguments.length; k++) if (arguments[k] > best) best = arguments[k];
  return best;
}
function backwards() {
  let text = "";
  for (let k = arguments.length - 1; k >= 0; k--) text += arguments[k] + ",";
  return text;
}
function pastTheEnd() {
  let text = "";
  for (let k = 0; k <= arguments.length + 1; k++) text += String(arguments[k]) + ",";
  return text;
}
function changedInTheLoop() {
  let sum = 0;
  for (let k = 0; k < arguments.length; k++) {
    sum += arguments[k];
    if (k + 1 < arguments.length) arguments[k + 1] = arguments[k + 1] * 2;
  }
  return sum;
}
function shortened() {
  let sum = 0;
  for (let k = 0; k < arguments.length; k++) {
    sum += arguments[k];
    if (k === 1) arguments.length = 2;
  }
  return sum + "/" + arguments.length;
}
function deleted() {
  let text = "";
  delete arguments[1];
  for (let k = 0; k < arguments.length; k++) text += String(arguments[k]) + ",";
  return text;
}
function strict() {
  "use strict";
  let sum = 0;
  for (let k = 0; k < arguments.length; k++) sum += arguments[k];
  return sum;
}

let check = 0;
for (let i = 0; i < 60000; i++) {
  check += total(i & 255, 1, 2) + totalAfterFirst(i & 7, 0.5, 2) + largest(i & 15, 3, 9.5) + strict(i & 3, 4);
}
const lines = [];
for (let i = 0; i < 400; i++) {
  const line = [
    total(),
    total(i),
    total(i, "x", 2),
    total(i, undefined, 2),
    total(i, null, true),
    total(NaN, 1),
    total(-0, -0),
    total(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    total(i, { valueOf: () => 5 }, [6]),
    totalAfterFirst(),
    totalAfterFirst("a", i, 1.5),
    largest(),
    largest("b", "a", i),
    backwards(i, "y", 2.5),
    pastTheEnd(i, 1),
    changedInTheLoop(i, 1, 2, 3),
    shortened(i, 1, 2, 3),
    deleted(i, 1, 2),
    strict(i, "z"),
    total.apply(null, [i, 1, 2]),
    total(...[i, 2.5]),
  ].join(" | ");
  if (i < 3 || i % 133 === 0) lines.push(line);
}
try {
  total(1, 2n);
} catch (error) {
  lines.push(error.constructor.name);
}
console.log(check);
console.log(lines.join("\n"));
