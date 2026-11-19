// Records pushed in an outer loop whose fields an inner loop changes
function play(rounds, players) {
  const board = [];
  for (let p = 0; p < players; p++) board.push({ id: p, score: 0, best: null });
  for (let r = 1; r <= rounds; r++) {
    for (const player of board) {
      const points = (r * (player.id + 3)) % 7;
      player.score += points;
      if (player.best === null || points > player.best) player.best = points;
      if (points === 6) player.score /= 2;
      if (points === 5) player.bonus = (player.bonus || "") + r;
    }
  }
  return board.map(player => Object.values(player).join(":")).join(" ");
}
console.log(play(4, 2));
console.log(play(10, 4));
console.log(play(0, 1), play(3, 0));
