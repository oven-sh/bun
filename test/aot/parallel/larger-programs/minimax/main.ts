// Games of two players behind one interface: connect four and a small reversi, a search with pruning, a table of positions, ordering, iterative deepening, matches between players, in two modules
import { Game, ConnectFour, Reversi, Search, Player, Searcher, Greedy, Dice, match } from "./lib";
for (const make of [() => new ConnectFour(), () => new Reversi()] as (() => Game<number>)[]) {
  const name = make().name;
  const searcher = new Searcher<number>(5);
  for (const [a, b] of [[searcher, new Dice<number>(7)], [new Greedy<number>(), searcher],
    [new Dice<number>(3), new Dice<number>(11)], [searcher,
    new Searcher<number>(3)]] as [Player<number>, Player<number>][]) {
    const r = match(make, a, b);
    console.log(name, a.name, b.name, r.winner, r.moves, r.end);
  }
  console.log(searcher.nodes);
  const g = make();
  const s = new Search(g);
  const {
    move, score, line
} = s.best(name === "four" ? 8 : 6);
  console.log(g.label(move), score, line.map(m => g.label(m)).join(" "), s.nodes, s.hits,
    s.cuts, s.table.size, g.key.toString(16));
  let sum = 0;
  for (let i = 0; i < 60; i++) {
    const w = match(make, new Dice<number>(i + 1),
      i % 2 ? new Greedy<number>() : new Dice<number>(i + 100)).winner;
    sum += w;
  }
  console.log(sum);
}
