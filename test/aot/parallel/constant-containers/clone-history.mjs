function snapshot(s) { return structuredClone(s); }
const game = { board: [0, 1, 2].map(() => [0, 0, 0]), turn: 0 };
const undo = [snapshot(game), snapshot(game)];
undo[0].board[1][1] = 7;
let sum = 0;
for (const row of undo[0].board) for (const v of row) sum += v | 0;
console.log(sum);
