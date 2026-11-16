// A score popped off a parsed list of fractions is a whole number boxed as a fraction. The board is a list of whole numbers.
const texts = process.argv.length > 2 ? process.argv.slice(2) : ["[0.5,2]", "[1.5,3]", "[2.5,7]", "[1,3]"];
function rank(board, score) {
  switch (score) {
    case 3:
      for (let i = 0; i < board.length; i++) board[i] = score;
      return "gold";
    case 2:
      for (let i = 0; i < board.length; i++) board[i] = score;
      return "silver";
    default:
      return "none";
  }
}
for (const text of texts) {
  const scores = JSON.parse(text);
  const board = new Array(5).fill(1);
  const medal = rank(board, scores.pop());
  let sum = 0;
  for (let i = 0; i < board.length; i++) sum = (sum * 3 + board[i]) | 0;
  console.log(medal, board.join(), board.indexOf(3), board.includes(2), JSON.stringify(board), sum, board.map(each => each + 1).join());
}
