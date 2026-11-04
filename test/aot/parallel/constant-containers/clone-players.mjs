function start() { return ["ann", "bob"].map(name => ({ name, scores: [0, 0] })); }
function play() {
  const game = structuredClone(start());
  game[0].scores[0] = 5;
  return game[0].scores[0] + game[1].scores[0] + "";
}
console.log(play());
console.log(play());
