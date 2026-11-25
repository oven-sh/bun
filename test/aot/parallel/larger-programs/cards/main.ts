// Cards: decks that are shuffled by seed, poker hands that are ranked and compared, a game of trick taking with players that choose, statistics, in two modules
import { Random, Card, Deck, Hand, LowPlayer, HighPlayer, RandomPlayer, ThinkingPlayer, Game, Stats } from "./lib";
for (const text of ["Ah Kh Qh Jh Th", "5c 4d 3h 2s Ac", "9c 9d 9h 9s 2c", "Kc Kd Kh 2s 2c",
  "2h 5h 9h Jh Kh", "7c 7d 4h 4s Ac", "8c 8d 4h 3s Ac", "8c 7d 4h 3s Ac",
  "Qc Qd Qh 3s Ac"]) console.log(String(new Hand(text.split(" ").map(Card.of))));
const random = new Random(2026);
console.log(JSON.stringify(Object.entries(Stats.hands(random, 12000)).sort()));
console.log(JSON.stringify(Stats.duel(random, 900)), Hand.evaluated);
for (const [seed, cards] of [[1, 5], [7, 10], [99, 13]] as const) {
  const r = new Random(seed);
  const thinker = new ThinkingPlayer("thinker");
  const game = new Game([new LowPlayer("low"), new HighPlayer("high"),
    new RandomPlayer("random", r), thinker], r);
  for (let i = 0; i < 250; i++) game.round(cards);
  console.log(seed, cards, game.players.map(p => p.name + "=" + p.points).join(" "),
    thinker.seen, game.log.join("; "));
}
for (const bad of [() => Card.of("1x"), () => new Hand([]), () => new Game([], random),
  () => new Deck(random).deal(53)]) try {
  bad();
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
