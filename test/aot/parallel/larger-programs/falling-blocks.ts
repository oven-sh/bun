// A game of falling blocks played by a program: pieces that rotate, a board in bits, a search over placements with weights that evolve, scores, levels, replays
type Cells = readonly (readonly [number, number])[];
enum Move {
  Left, Right, Turn, Back, Down, Drop
}
interface Weights {
  readonly lines: number;
  readonly height: number;
  readonly holes: number;
  readonly bumps: number;
  readonly wells: number
}
interface Placement {
  readonly turn: number;
  readonly x: number;
  readonly y: number;
  readonly score: number;
  readonly path: readonly Move[]
}
class Random {
  #s: number;
  constructor(seed: number) {
    this.#s = seed >>> 0 || 1;
  }
  next() {
    this.#s ^= this.#s << 13;
    this.#s ^= this.#s >>> 17;
    this.#s ^= this.#s << 5;
    this.#s >>>= 0;
    return this.#s / 4294967296;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  normal() {
    let t = 0;
    for (let i = 0; i < 6; i++) t += this.next();
    return (t - 3) / 0.7;
  }
}
class Piece {
  static readonly all: readonly Piece[] = [["I", "....####........"], ["O", ".##..##."], ["T",
    ".#.###..."], ["S", ".####...."], ["Z", "##..##..."], ["J", "#..###..."], ["L",
    "..####..."]].map(([name, text], i) => new Piece(name, text, i));
  readonly turns: readonly Cells[];
  readonly rows: readonly (readonly { mask: number; dy: number }[])[];
  private constructor(readonly name: string, text: string, readonly index: number) {
    const size = text.length === 8 ? 4 : Math.sqrt(text.length);
    let cells: [number, number][] = [...text].flatMap((c, i): [number,
      number][] => (c === "#" ? [[i % size, Math.floor(i / size)]] : []));
    const turns: Cells[] = [];
    for (let t = 0; t < 4; t++) {
      turns.push(cells.map((c): readonly [number, number] => [...c] as [number,
        number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
      if (name !== "O") cells = cells.map(([x, y]) => [size - 1 - y, x]);
    }
    this.turns = turns;
    this.rows = turns.map(list => {
      const out = new Map<number, number>();
      for (const [x, y] of list) out.set(y, (out.get(y) ?? 0) | (1 << x));
      return [...out].map(([dy, mask]) => ({ dy, mask }));
  });
  }
  get distinct() {
    return this.name === "O" ? 1 : "ISZ".includes(this.name) ? 2 : 4;
  }
}
class Board {
  static readonly width = 10;
  static readonly height = 20;
  static readonly full = (1 << 10) - 1;
  readonly rows: Uint16Array;
  constructor(rows?: Uint16Array) {
    this.rows = rows ?? new Uint16Array(Board.height);
  }
  copy() {
    return new Board(this.rows.slice());
  }
  fits(piece: Piece, turn: number, x: number, y: number): boolean {
    for (const { dy, mask } of piece.rows[turn]) {
      const yy = y + dy;
      if (x < 0) {
        if (mask & ((1 << -x) - 1)) return false;
      }
      const m = x < 0 ? mask >> -x : mask << x;
      if (m > Board.full || yy >= Board.height) return false;
      if (yy >= 0 && this.rows[yy] & m) return false;
    }
    return true;
  }
  place(piece: Piece, turn: number, x: number, y: number): number {
    for (const { dy,
      mask } of piece.rows[turn]) if (y + dy >= 0) this.rows[y + dy] |= x < 0 ? mask >> -x : mask << x;
    let cleared = 0;
    for (let r = Board.height - 1; r >= 0; ) {
      if (this.rows[r] !== Board.full) {
        r--;
        continue;
      }
      cleared++;
      this.rows.copyWithin(1, 0, r);
      this.rows[0] = 0;
    }
    return cleared;
  }
  get heights(): number[] {
    const out: number[] = [];
    for (let x = 0; x < Board.width; x++) {
      let y = 0;
      while (y < Board.height && !(this.rows[y] & (1 << x))) y++;
      out.push(Board.height - y);
    }
    return out;
  }
  features(): {
    height: number;
    holes: number;
    bumps: number;
    wells: number
  }
  {
    const h = this.heights;
    let holes = 0, bumps = 0, wells = 0, height = 0;
    for (let x = 0; x < Board.width; x++) {
      height += h[x];
      for (let y = Board.height - h[x] + 1; y < Board.height; y++) if (!(this.rows[y] & (1 << x))) holes++;
      if (x) bumps += Math.abs(h[x] - h[x - 1]);
      const left = x ? h[x - 1] : Board.height,
        right = x < Board.width - 1 ? h[x + 1] : Board.height, depth = Math.min(left,
        right) - h[x];
      if (depth > 0) wells += (depth * (depth + 1)) / 2;
    }
    return {
      height, holes, bumps, wells
  };
  }
  toString() {
    return [...this.rows].map(r => Array.from({ length: Board.width }, (_,
      x) => (r & (1 << x) ? "#" : ".")).join("")).filter(r => r.includes("#")).join("/");
  }
  get hash() {
    let h = 0;
    for (const r of this.rows) h = (Math.imul(h, 31) + r) >>> 0;
    return h;
  }
}
abstract class Chooser {
  tried = 0;
  abstract choose(g: Game): Placement | null;
  *placements(board: Board, piece: Piece): Generator<{
    turn: number;
    x: number;
    y: number
  }
  > {
    for (let turn = 0; turn < piece.distinct; turn++) for (let x = -2; x < Board.width; x++) {
      let y = -2;
      if (!board.fits(piece, turn, x, y)) continue;
      while (board.fits(piece, turn, x, y + 1)) y++;
      if (y >= -1) {
        this.tried++;
        yield {
          turn, x, y
      };
      }
    }
  }
  static path(turn: number, x: number): Move[] {
    const out: Move[] = [];
    for (let i = 0; i < (turn === 3 ? 1 : turn); i++) out.push(turn === 3 ? Move.Back : Move.Turn);
    for (let i = 3; i < x; i++) out.push(Move.Right);
    for (let i = 3; i > x; i--) out.push(Move.Left);
    out.push(Move.Drop);
    return out;
  }
}
class WeightedChooser extends Chooser {
  constructor(readonly weights: Weights, readonly ahead = false) {
    super();
  }
  #score(board: Board, cleared: number): number {
    const f = board.features(), w = this.weights;
    return w.lines * cleared * cleared - w.height * f.height - w.holes * f.holes - w.bumps * f.bumps - w.wells * f.wells;
  }
  choose(g: Game): Placement | null {
    let best: Placement | null = null;
    for (const { turn, x, y } of this.placements(g.board, g.piece)) {
      const board = g.board.copy();
      const cleared = board.place(g.piece, turn, x, y);
      let score = this.#score(board, cleared);
      if (this.ahead) {
        let next = -Infinity;
        for (const p of this.placements(board, g.next)) {
          const b = board.copy();
          const c = b.place(g.next, p.turn, p.x, p.y);
          next = Math.max(next, this.#score(b, c));
        }
        score = score * 0.2 + next;
      }
      if (!best || score > best.score) best = {
        turn, x, y, score, path: Chooser.path(turn, x)
    };
    }
    return best;
  }
}
class RandomChooser extends Chooser {
  constructor(readonly random: Random) {
    super();
  }
  choose(g: Game): Placement | null {
    const all = [...this.placements(g.board, g.piece)];
    if (!all.length) return null;
    const p = all[this.random.int(all.length)];
    return {
      ...p, score: 0, path: Chooser.path(p.turn, p.x)
  };
  }
}
class LowestChooser extends Chooser {
  choose(g: Game): Placement | null {
    let best: Placement | null = null;
    for (const p of this.placements(g.board, g.piece)) if (!best || p.y > best.y) best = {
      ...p, score: p.y, path: Chooser.path(p.turn, p.x)
  };
    return best;
  }
}
class Game {
  readonly board = new Board();
  piece: Piece;
  next: Piece;
  #bag: Piece[] = [];
  lines = 0;
  score = 0;
  pieces = 0;
  over = false;
  readonly moves: Move[] = [];
  readonly counts = [0, 0, 0, 0, 0];
  static readonly points = [0, 40, 100, 300, 1200];
  constructor(readonly random: Random) {
    this.piece = this.#draw();
    this.next = this.#draw();
  }
  #draw(): Piece {
    if (!this.#bag.length) {
      this.#bag = [...Piece.all];
      for (let i = this.#bag.length - 1; i > 0; i--) {
        const k = this.random.int(i + 1);
        [this.#bag[i], this.#bag[k]] = [this.#bag[k], this.#bag[i]];
      }
    }
    return this.#bag.pop()!;
  }
  get level() {
    return 1 + Math.floor(this.lines / 10);
  }
  apply(p: Placement) {
    let x = 3, turn = 0, y = -2;
    for (const m of p.path) {
      this.moves.push(m);
      switch (m) {
        case Move.Left: if (this.board.fits(this.piece, turn, x - 1, y)) x--;
        break;
        case Move.Right: if (this.board.fits(this.piece, turn, x + 1, y)) x++;
        break;
        case Move.Turn: case Move.Back: {
          const t = (turn + (m === Move.Turn ? 1 : 3)) % 4;
          for (const dx of [0, -1, 1, -2, 2]) if (this.board.fits(this.piece, t, x + dx, y)) {
            turn = t;
            x += dx;
            break;
          }
          break;
        }
        case Move.Down: if (this.board.fits(this.piece, turn, x, y + 1)) y++;
        break;
        case Move.Drop: while (this.board.fits(this.piece, turn, x, y + 1)) y++;
        break;
      }
    }
    const cleared = this.board.place(this.piece, turn, x, y);
    this.lines += cleared;
    this.counts[cleared]++;
    this.score += Game.points[cleared] * this.level;
    this.pieces++;
    this.piece = this.next;
    this.next = this.#draw();
    if (!this.board.fits(this.piece, 0, 3, -2) || this.board.rows[0]) this.over = true;
  }
  play(c: Chooser, limit: number): this {
    while (!this.over && this.pieces < limit) {
      const p = c.choose(this);
      if (!p) {
        this.over = true;
        break;
      }
      this.apply(p);
    }
    return this;
  }
  toString() {
    return `${this.pieces} pieces ${this.lines} lines ${this.score} points level ${this.level} ${this.counts.join("/")} ${this.over ? "over" : "going"}`;
  }
}
class Evolution {
  generation = 0;
  readonly population: {
    weights: Weights;
    fitness: number
}[] = [];
  constructor(readonly random: Random, readonly size: number, readonly pieces: number) {
    for (let i = 0; i < size; i++) this.population.push({ weights: this.#make(() => random.next() * 2),
      fitness: 0 });
  }
  #make(f: (key: keyof Weights) => number): Weights {
    return {
      lines: f("lines"), height: f("height"), holes: f("holes"), bumps: f("bumps"),
        wells: f("wells")
  };
  }
  #measure(w: Weights): number {
    let total = 0;
    for (const seed of [11, 12]) {
      const g = new Game(new Random(seed)).play(new WeightedChooser(w), this.pieces);
      total += g.lines * 10 + g.pieces - g.board.features().holes;
    }
    return total;
  }
  step(): number {
    for (const p of this.population) p.fitness = this.#measure(p.weights);
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0].fitness;
    const keep = Math.ceil(this.size / 3);
    for (let i = keep; i < this.size; i++) {
      const a = this.population[this.random.int(keep)].weights,
        b = this.population[this.random.int(keep)].weights;
      this.population[i] = {
        weights: this.#make(k => Math.max(0,
          (this.random.next() < 0.5 ? a : b)[k] + this.random.normal() * 0.15)), fitness: 0
    };
    }
    this.generation++;
    return best;
  }
}
console.log(Piece.all.map(p => p.name + p.distinct + p.turns.map(t => t.length).join("")).join(" "));
const good: Weights = {
  lines: 1.2, height: 0.5, holes: 0.9, bumps: 0.25, wells: 0.1
};
for (const [name, make, limit] of [["random", () => new RandomChooser(new Random(5)), 500],
  ["lowest", () => new LowestChooser(), 500], ["weighted", () => new WeightedChooser(good),
  900], ["ahead", () => new WeightedChooser(good, true), 60]] as [string, () => Chooser,
  number][]) for (const seed of [1, 2026]) {
  const chooser = make();
  const g = new Game(new Random(seed)).play(chooser, limit);
  console.log(name, seed, String(g), chooser.tried, g.moves.length, g.board.hash,
    g.board.heights.join());
  if (name === "lowest" && seed === 1) console.log(String(g.board));
}
const evolution = new Evolution(new Random(99), 9, 80);
const bests: number[] = [];
for (let i = 0; i < 5; i++) bests.push(evolution.step());
console.log(bests.join(), evolution.generation, JSON.stringify(evolution.population[0].weights,
  (_, v) => (typeof v === "number" ? +v.toFixed(4) : v)));
const board = new Board();
for (let x = 0; x < 9; x++) board.rows[19] |= 1 << x;
console.log(board.place(Piece.all[0], 1, 7, 16), String(board), board.features().holes,
  board.fits(Piece.all[1], 0, 9, 0), board.fits(Piece.all[0], 0, -1, 0));
