// Instances in a list, sorted by two fields, reversed, and by a compare of their own
class Player {
  constructor(name, score) {
    this.name = name;
    this.score = score;
  }
  static compare(a, b) {
    return b.score - a.score || (a.name < b.name ? -1 : 1);
  }
}
function table(scores) {
  const players = scores.map((score, i) => new Player("pqrst"[i], score));
  const ranked = [...players].sort(Player.compare);
  players.sort((a, b) => a.score - b.score).reverse();
  return ranked.map(p => p.name + p.score).join() + " " + players.map(p => p.name).join("") + " " + players.findIndex(p => p.score === scores[0]);
}
console.log(table([3, 1, 2]));
console.log(table([5, 5, 5, 7]));
console.log(table([1]));
