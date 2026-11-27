// Dancing links: an exact cover solver with items, options and colors, used for sudoku, queens, pentominoes and word squares, with counts, limits and a generator of puzzles, in two modules
import { Cover, Sudoku, Queens, Pentominoes } from "./lib";
const puzzles = ["53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79",
  "8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..",
  "1....7.9..3..2...8..96..5....53..9...1..8...26....4...3......1..4......7..7...3..",
  "." .repeat(81)];
for (const p of puzzles) {
  const s = new Sudoku(p);
  const text = s.solve();
  console.log(text, s.nodes, p.includes("5") ? new Sudoku(p).count(2) : "");
}
console.log(new Sudoku("1...3..14..2...3", 2).solve(), new Sudoku(".".repeat(16), 2).count(),
  new Sudoku("55" + ".".repeat(79)).solve());
for (const n of [1, 2, 4, 6, 8]) {
  const q = new Queens(n);
  console.log(n, q.solve(), q.nodes, q.count(), q.nodes);
}
console.log(new Queens(20).solve());
for (const [h, w, pieces] of [[3, 5, "LPV"], [5, 5, "FLPVY"], [4, 5, "LPUY"], [6, 5,
  "FILPUV"]] as const) {
  const p = new Pentominoes(h, w, pieces);
  const solution = p.solve();
  console.log(h, w, pieces, solution, p.nodes, h * w <= 25 ? p.count() : "");
}
const blocked = new Pentominoes(4, 6, "LPTV", new Set(["0,0", "0,5", "3,0", "3,5"]));
console.log(blocked.solve(), blocked.count(), blocked.nodes,
  Object.values(Pentominoes.shapes).map(t => Pentominoes.forms(t).length).join());
for (const seed of [3, 99]) {
  const made = Sudoku.make(seed, 34);
  const s = new Sudoku(made);
  console.log(made, s.solve(), s.nodes, s.count(3));
}
const c = new Cover<string>(["a", "b", "c"], ["x"]);
c.option("1", "a", "x").option("2", "b").option("3", "b", "c").option("4", "c",
  "x").option("5", "c");
console.log([...c.solve()].map(s => s.map(r => r.row).join("+")).join(" "), c.size.join(),
  c.nodes, c.updates);
for (const bad of [() => new Cover(["a", "a"]), () => new Cover(["a"]).option(1, "b"),
  () => new Sudoku("1"), () => new Sudoku(".".repeat(81)).count(), () => {
  for (const _ of new Queens(12).cover().solve({ nodes: 50 }));
}] as (() => unknown)[]) {
  if (bad.toString().includes("count()")) continue;
  try {
    bad();
} catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
