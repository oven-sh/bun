// Games of two players behind one interface: connect four and a small reversi, a search with pruning, a table of positions, ordering, iterative deepening, matches between players
export type Side = 1 | -1;
export interface Game<M> {
  readonly name: string;
  readonly turn: Side;
  moves(): M[];
  play(move: M): void;
  undo(): void;
  winner(): Side | 0 | null;
  evaluate(): number;
  readonly key: bigint;
  show(): string;
  label(move: M): string
}
export class Zobrist {
  #state = 88172645463325252n;
  readonly keys: bigint[];
  constructor(n: number) {
    this.keys = Array.from({ length: n }, () => this.#next());
  }
  #next(): bigint {
    let x = this.#state;
    x ^= BigInt.asUintN(64, x << 13n);
    x ^= x >> 7n;
    x ^= BigInt.asUintN(64, x << 17n);
    return (this.#state = x);
  }
}
export abstract class Board<M> implements Game<M> {
  readonly cells: Int8Array;
  turn: Side = 1;
  key = 0n;
  protected readonly zobrist: Zobrist;
  abstract readonly name: string;
  constructor(readonly width: number, readonly height: number) {
    this.cells = new Int8Array(width * height);
    this.zobrist = new Zobrist(width * height * 2 + 1);
  }
  protected at(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.width ||
      y >= this.height ? 2 : this.cells[y * this.width + x];
  }
  protected set(i: number, side: Side | 0) {
    const old = this.cells[i];
    if (old) this.key ^= this.zobrist.keys[i * 2 + (old === 1 ? 0 : 1)];
    this.cells[i] = side;
    if (side) this.key ^= this.zobrist.keys[i * 2 + (side === 1 ? 0 : 1)];
  }
  protected pass() {
    this.turn = -this.turn as Side;
    this.key ^= this.zobrist.keys[this.zobrist.keys.length - 1];
  }
  show() {
    let out = "";
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out += ".xo"[this.cells[y * this.width + x] & 3 ? (this.cells[y * this.width + x] === 1 ? 1 : 2) : 0];
      out += "/";
    }
    return out;
  }
  abstract moves(): M[];
  abstract play(move: M): void;
  abstract undo(): void;
  abstract winner(): Side | 0 | null;
  abstract evaluate(): number;
  abstract label(move: M): string;
}
export class ConnectFour extends Board<number> {
  readonly name = "four";
  readonly #heights: number[];
  readonly #done: number[] = [];
  #won: Side | 0 = 0;
  static readonly order = [3, 2, 4, 1, 5, 0, 6];
  readonly #lines: Int32Array[];
  constructor() {
    super(7, 6);
    this.#heights = new Array(7).fill(0);
    const lines: Int32Array[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 7; x++) for (const [dx, dy] of [[1, 0], [0,
      1], [1, 1], [1, -1]]) {
      const ex = x + dx * 3, ey = y + dy * 3;
      if (ex < 7 && ey < 6 && ey >= 0) lines.push(Int32Array.from([0, 1, 2, 3],
        k => (y + dy * k) * 7 + x + dx * k));
    }
    this.#lines = lines;
  }
  moves() {
    return this.#won ? [] : ConnectFour.order.filter(c => this.#heights[c] < 6);
  }
  play(c: number) {
    const y = this.#heights[c]++, i = y * 7 + c;
    this.set(i, this.turn);
    this.#done.push(c);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let n = 1;
      for (const s of [1, -1]) for (let k = 1; this.at(c + dx * k * s,
        y + dy * k * s) === this.turn; k++) n++;
      if (n >= 4) this.#won = this.turn;
    }
    this.pass();
  }
  undo() {
    const c = this.#done.pop()!;
    const y = --this.#heights[c];
    this.pass();
    this.set(y * 7 + c, 0);
    this.#won = 0;
  }
  winner() {
    return this.#won ? this.#won : this.#done.length === 42 ? 0 : null;
  }
  evaluate() {
    let score = 0;
    for (const line of this.#lines) {
      let a = 0, b = 0;
      for (let k = 0; k < 4; k++) {
        const v = this.cells[line[k]];
        if (v === 1) a++;
        else if (v === -1) b++;
      }
      if (a && !b) score += a * a * a;
      else if (b && !a) score -= b * b * b;
    }
    return score * this.turn;
  }
  label(c: number) {
    return "abcdefg"[c];
  }
}
export interface Flip {
  at: number;
  flipped: number[]
}
export class Reversi extends Board<number> {
  readonly name = "reversi";
  readonly #done: (Flip | null)[] = [];
  static readonly weights = [9, -3, 2, 2, -3, 9, -3, -4, 0, 0, -4, -3, 2, 0, 1, 1, 0, 2, 2, 0,
    1, 1, 0, 2, -3, -4, 0, 0, -4, -3, 9, -3, 2, 2, -3, 9];
  constructor() {
    super(6, 6);
    this.set(14, -1);
    this.set(15, 1);
    this.set(20, 1);
    this.set(21, -1);
  }
  #flips(i: number, side: Side): number[] {
    if (this.cells[i]) return [];
    const out: number[] = [], x = i % 6, y = (i / 6) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      let k = 1;
      while (this.at(x + dx * k, y + dy * k) === -side) k++;
      if (k > 1 && this.at(x + dx * k,
        y + dy * k) === side) for (let j = 1; j < k; j++) out.push((y + dy * j) * 6 + x + dx * j);
    }
    return out;
  }
  #any(side: Side) {
    for (let i = 0; i < 36; i++) if (!this.cells[i] && this.#flips(i, side).length) return true;
    return false;
  }
  moves() {
    const out: number[] = [];
    for (let i = 0; i < 36; i++) if (this.#flips(i, this.turn).length) out.push(i);
    if (!out.length && this.#any(-this.turn as Side)) out.push(-1);
    return out.sort((a, b) => (Reversi.weights[b] ?? -9) - (Reversi.weights[a] ?? -9));
  }
  play(i: number) {
    if (i < 0) {
      this.#done.push(null);
      this.pass();
      return;
    }
    const flipped = this.#flips(i, this.turn);
    this.set(i, this.turn);
    for (const f of flipped) this.set(f, this.turn);
    this.#done.push({ at: i, flipped });
    this.pass();
  }
  undo() {
    const d = this.#done.pop();
    this.pass();
    if (!d) return;
    for (const f of d.flipped) this.set(f, -this.turn as Side);
    this.set(d.at, 0);
  }
  winner() {
    if (this.#any(1) || this.#any(-1)) return null;
    let sum = 0;
    for (const c of this.cells) sum += c;
    return Math.sign(sum) as Side | 0;
  }
  evaluate() {
    let score = 0;
    for (let i = 0; i < 36; i++) score += this.cells[i] * Reversi.weights[i];
    return score * this.turn;
  }
  label(i: number) {
    return i < 0 ? "pass" : "abcdef"[i % 6] + (((i / 6) | 0) + 1);
  }
}
export const enum Bound {
  Exact, Lower, Upper
}
export interface Stored<M> {
  depth: number;
  score: number;
  bound: Bound;
  move: M | null
}
export class Search<M> {
  readonly table = new Map<bigint, Stored<M>>();
  nodes = 0;
  hits = 0;
  cuts = 0;
  constructor(readonly game: Game<M>, readonly limit = 1e9) {
  }
  static readonly WIN = 100000;
  #negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    const won = this.game.winner();
    if (won !== null) return won === 0 ? 0 : won === this.game.turn ? Search.WIN - ply : ply - Search.WIN;
    if (depth === 0) return this.game.evaluate();
    const from = alpha;
    const kept = this.table.get(this.game.key);
    if (kept && kept.depth >= depth) {
      this.hits++;
      if (kept.bound === Bound.Exact) return kept.score;
      if (kept.bound === Bound.Lower) alpha = Math.max(alpha, kept.score);
      else beta = Math.min(beta, kept.score);
      if (alpha >= beta) return kept.score;
    }
    let best = -Infinity, move: M | null = null;
    const moves = this.game.moves();
    if (kept?.move !== null && kept?.move !== undefined) {
      const i = moves.indexOf(kept.move);
      if (i > 0) {
        moves.splice(i, 1);
        moves.unshift(kept.move);
      }
    }
    for (const m of moves) {
      this.game.play(m);
      const score = -this.#negamax(depth - 1, -beta, -alpha, ply + 1);
      this.game.undo();
      if (score > best) {
        best = score;
        move = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        this.cuts++;
        break;
      }
      if (this.nodes > this.limit) break;
    }
    this.table.set(this.game.key, { depth, score: best,
      bound: best <= from ? Bound.Upper : best >= beta ? Bound.Lower : Bound.Exact, move });
    return best;
  }
  best(depth: number): {
    move: M;
    score: number;
    line: M[]
  }
  {
    let score = 0;
    for (let d = 1; d <= depth && this.nodes <= this.limit; d++) score = this.#negamax(d,
      -Infinity, Infinity, 0);
    const line: M[] = [];
    for (let i = 0; i < depth; i++) {
      const m = this.table.get(this.game.key)?.move;
      if (m === null || m === undefined || this.game.winner() !== null ||
        !this.game.moves().includes(m)) break;
      line.push(m);
      this.game.play(m);
    }
    for (const _ of line) this.game.undo();
    return {
      move: line[0], score, line
  };
  }
}
export abstract class Player<M> {
  constructor(readonly name: string) {
  }
  abstract choose(g: Game<M>): M;
}
export class Searcher<M> extends Player<M> {
  nodes = 0;
  constructor(readonly depth: number) {
    super("search" + depth);
  }
  choose(g: Game<M>) {
    const s = new Search(g);
    const {
      move
  } = s.best(this.depth);
    this.nodes += s.nodes;
    return move;
  }
}
export class Greedy<M> extends Player<M> {
  constructor() {
    super("greedy");
  }
  choose(g: Game<M>) {
    let best: M | null = null, top = -Infinity;
    for (const m of g.moves()) {
      g.play(m);
      const v = g.winner() === null ? -g.evaluate() : 1e6;
      g.undo();
      if (v > top) {
        top = v;
        best = m;
      }
    }
    return best!;
  }
}
export class Dice<M> extends Player<M> {
  #seed: number;
  constructor(seed: number) {
    super("dice" + seed);
    this.#seed = seed;
  }
  choose(g: Game<M>) {
    const m = g.moves();
    this.#seed = (this.#seed * 48271) % 2147483647;
    return m[this.#seed % m.length];
  }
}
export function match<M>(make: () => Game<M>, a: Player<M>, b: Player<M>): {
  winner: Side | 0;
  moves: string;
  end: string
}
{
  const g = make();
  let moves = "";
  let w: Side | 0 | null;
  while ((w = g.winner()) === null) {
    const m = (g.turn === 1 ? a : b).choose(g);
    if (!g.moves().includes(m)) throw new RangeError("move " + m);
    moves += g.label(m);
    g.play(m);
  }
  return {
    winner: w, moves, end: g.show()
};
}
