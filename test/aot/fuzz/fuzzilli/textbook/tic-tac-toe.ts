type Mark = "x" | "o" | "";
const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
function winner(board: Mark[]): Mark {
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return "";
}
console.log(winner(["x", "o", "", "o", "x", "", "", "", "x"]), winner(["x", "o", "x", "", "", "", "", "", ""]) === "");
