// Bounds that are written down: the inner loop pushes first, then the outer one
function board(mark) {
  const cells = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      cells.push(x === y ? mark : y * 3 + x);
    }
    cells.push("/");
  }
  return cells.join("");
}
console.log(board("x"));
console.log(board(0.5));
console.log(board(null), board(10));
