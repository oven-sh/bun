// Chess moves: a board of squares, pieces as classes, legal moves with castles, passing captures and promotions, counts by depth, notation read and written, a small search, in two modules
import { square, Board, Search } from "./lib.mjs";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
for (const [text, depth] of [[START, 3],
  ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2],
  ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3], ["n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1",
  2], ["rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 2]]) {
  const b = Board.parse(text);
  const counts = [];
  for (let d = 1; d <= depth; d++) counts.push(b.count(d));
  console.log(counts.join(), String(b) === text, b.check, b.state, b.evaluate());
}
const game = Board.parse(START);
const played = [];
for (const m of "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1 Bd6 e5".split(" ")) {
  const move = game.read(m);
  played.push(game.write(move));
  game.play(move);
}
console.log(played.join(" "), String(game));
while (game.past.length) game.undo();
console.log(String(game) === START);
let seed = 5;
const random = n => (seed = (seed * 48271) % 2147483647) % n;
const ends = {
};
let hash = 0;
for (let g = 0; g < 8; g++) {
  const b = Board.parse(START);
  const s = new Search();
  for (let i = 0; i < 36 && b.state === "going"; i++) {
    const legal = b.legal();
    const m = g % 2 === i % 2 && i > 6 ? s.best(b, 1).move : legal[random(legal.length)];
    const text = b.write(m);
    for (const c of text) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    b.play(m);
  }
  ends[b.state] = (ends[b.state] ?? 0) + 1;
  hash = (hash + String(b).length) >>> 0;
  if (g < 2) console.log(String(b), s.nodes);
}
console.log(hash, JSON.stringify(ends), Board.made);
for (const [text, depth] of [["6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 2],
  ["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", 1],
  ["r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", 2]]) {
  const b = Board.parse(text), s = new Search();
  const {
    move, score
} = s.best(b, depth);
  console.log(move ? b.write(move) : b.state, score, s.nodes);
}
for (const bad of [() => Board.parse("x"), () => Board.parse("9/8/8/8/8/8/8/8"),
  () => square("z9"), () => Board.parse(START).read("e5")]) try {
  bad();
} catch (e) {
  console.log(e.name, e.message);
}
