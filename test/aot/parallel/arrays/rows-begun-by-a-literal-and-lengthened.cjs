// Rows begin as a literal of one number, and a loop stores from the end of the literal on; rows of other lengths and kinds come too.
"use strict";
function grid(height, width) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows[y] = [y * 2];
    for (let x = 1; x < width; x++) rows[y][x] = x + (y > 0 ? rows[y - 1][x] : 1);
  }
  return rows;
}
function lengthen(rows, from, width) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = from; x < width; x++) rows[y][x] = x * 10 + y;
  }
  return rows;
}
const text = rows => rows.map(row => (Array.isArray(row) ? "[" + Array.from(row, (one, at) => (at in row ? String(one) : "hole")).join(" ") + "]" : JSON.stringify(row))).join("");
for (let round = 0; round < 30; round++) {
  const rows = grid(3 + (round % 3), 4 + (round % 5));
  if (round % 11 === 0) console.log(text(rows), text(lengthen([[1], [2, 3], []], 1, 4)));
}
console.log(text(grid(0, 3)), text(grid(2, 1)), text(grid(1, 0)));
console.log(text(lengthen([[], [1, 2, 3, 4, 5, 6], [0.5]], 3, 5)));
console.log(text(lengthen([["a"], [null, undefined], [1, , 3]], 1, 3)));
console.log(text(lengthen([new Uint8Array(2), { length: 1 }], 0, 3)));
const same = [1];
console.log(text(lengthen([same, same], 1, 3)));
for (const row of [Object.freeze([1]), Object.preventExtensions([1]), null]) {
  try {
    console.log(text(lengthen([[5], row], 1, 2)));
  } catch (error) {
    console.log(error.constructor.name, text([row]));
  }
}
