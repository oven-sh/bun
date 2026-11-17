// Chess moves: a board of squares, pieces as classes, legal moves with castles, passing captures and promotions, counts by depth, notation read and written, a small search
export const FILES = "abcdefgh";
export const square = text => {
  const x = FILES.indexOf(text[0]), y = 8 - Number(text[1]);
  if (x < 0 || !(y >= 0 && y < 8) ||
    text.length !== 2) throw new RangeError("no square " + text);
  return y * 8 + x;
};
export const label = i => FILES[i & 7] + (8 - (i >> 3));
export class Piece {
  static value = 0;
  constructor(color) {
    this.color = color;
  }
  get letter() {
    return this.color > 0 ? this.constructor.letter.toUpperCase() : this.constructor.letter;
  }
  get worth() {
    return this.constructor.value * this.color;
  }
  *targets() {
  }
  attacks(board, from, to) {
    for (const t of this.targets(board, from, true)) if (t === to) return true;
    return false;
  }
}
export class Slider extends Piece {
  *targets(board, from) {
    const x0 = from & 7, y0 = from >> 3;
    for (const [dx, dy] of this.constructor.rays) for (let x = x0 + dx, y = y0 + dy; x >= 0 &&
      y >= 0 && x < 8 && y < 8; x += dx, y += dy) {
      const o = board.at[y * 8 + x];
      if (o === null) yield y * 8 + x;
      else {
        if (o.color !== this.color) yield y * 8 + x;
        break;
      }
    }
  }
}
export class Stepper extends Piece {
  *targets(board, from) {
    const x0 = from & 7, y0 = from >> 3;
    for (const [dx, dy] of this.constructor.steps) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x > 7 || y > 7) continue;
      const o = board.at[y * 8 + x];
      if (o === null || o.color !== this.color) yield y * 8 + x;
    }
  }
}
export class Rook extends Slider {
  static letter = "r";
  static value = 500;
  static rays = [[1, 0], [-1, 0], [0, 1], [0, -1]];
}
export class Bishop extends Slider {
  static letter = "b";
  static value = 330;
  static rays = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
}
export class Queen extends Slider {
  static letter = "q";
  static value = 900;
  static rays = [...Rook.rays, ...Bishop.rays];
}
export class Knight extends Stepper {
  static letter = "n";
  static value = 320;
  static steps = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
}
export class King extends Stepper {
  static letter = "k";
  static value = 0;
  static steps = Queen.rays;
}
export class Pawn extends Piece {
  static letter = "p";
  static value = 100;
  get forward() {
    return this.color > 0 ? -8 : 8;
  }
  *targets(board, from, attack = false) {
    const x = from & 7, y = from >> 3;
    if (!attack) {
      const one = from + this.forward;
      if (board.at[one] === null) {
        yield one;
        const two = one + this.forward;
        if (y === (this.color > 0 ? 6 : 1) && board.at[two] === null) yield two;
      }
    }
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (nx < 0 || nx > 7) continue;
      const to = from + this.forward + dx, o = board.at[to];
      if (attack || (o !== null && o !== undefined && o.color !== this.color) ||
        to === board.passing) yield to;
    }
  }
}
export const KINDS = {
  p: Pawn, n: Knight, b: Bishop, r: Rook, q: Queen, k: King
};
export class Board {
  static made = 0;
  constructor(at, turn, castles, passing, half = 0, full = 1) {
    this.at = at;
    this.turn = turn;
    this.castles = castles;
    this.passing = passing;
    this.half = half;
    this.full = full;
    this.kings = {
      1: -1, [-1]: -1
  };
    at.forEach((p, i) => {
      if (p instanceof King) this.kings[p.color] = i;
  });
    this.past = [];
    Board.made++;
  }
  static parse(text) {
    const [rows, turn = "w", castles = "-", passing = "-", half = "0",
      full = "1"] = text.split(" ");
    const at = [];
    for (const row of rows.split("/")) {
      const start = at.length;
      for (const c of row) {
        if (c >= "1" && c <= "8") for (let i = 0; i < +c; i++) at.push(null);
        else {
          const K = KINDS[c.toLowerCase()];
          if (!K) throw new SyntaxError("no piece " + c);
          at.push(new K(c < "a" ? 1 : -1));
        }
      }
      if (at.length !== start + 8) throw new SyntaxError("row " + row);
    }
    if (at.length !== 64) throw new SyntaxError("needs 64 squares");
    return new Board(at, turn === "w" ? 1 : -1, new Set(castles === "-" ? "" : castles),
      passing === "-" ? -1 : square(passing), +half, +full);
  }
  toString() {
    let out = "";
    for (let y = 0; y < 8; y++) {
      let n = 0;
      for (let x = 0; x < 8; x++) {
        const p = this.at[y * 8 + x];
        if (p === null) n++;
        else {
          if (n) out += n;
          n = 0;
          out += p.letter;
        }
      }
      if (n) out += n;
      if (y < 7) out += "/";
    }
    return `${out} ${this.turn > 0 ? "w" : "b"} ${["K", "Q", "k", "q"].filter(c => this.castles.has(c)).join("") || "-"} ${this.passing < 0 ? "-" : label(this.passing)} ${this.half} ${this.full}`;
  }
  attacked(to, by) {
    for (let i = 0; i < 64; i++) {
      const p = this.at[i];
      if (p !== null && p.color === by && p.attacks(this, i, to)) return true;
    }
    return false;
  }
  get check() {
    return this.attacked(this.kings[this.turn], -this.turn);
  }
  *pseudo() {
    for (let from = 0; from < 64; from++) {
      const p = this.at[from];
      if (p === null || p.color !== this.turn) continue;
      for (const to of p.targets(this, from)) {
        if (p instanceof Pawn && (to < 8 || to > 55)) for (const k of "qrbn") yield {
          from, to, promote: k
      };
        else yield {
          from, to, promote: null
      };
      }
      if (p instanceof King) {
        const home = this.turn > 0 ? 60 : 4;
        if (from === home) for (const [c, side, empty] of [["K", 1, [1, 2]], ["Q", -1, [-1, -2,
          -3]]]) if (this.castles.has(this.turn > 0 ? c : c.toLowerCase()) &&
          empty.every(d => this.at[home + d] === null) && !this.attacked(home, -this.turn) &&
          !this.attacked(home + side, -this.turn)) yield {
          from, to: home + 2 * side, promote: null
      };
      }
    }
  }
  play(m) {
    const p = this.at[m.from], taken = this.at[m.to];
    const undo = {
      m, p, taken, castles: this.castles, passing: this.passing, half: this.half, rook: null,
        en: -1
  };
    this.at[m.from] = null;
    this.at[m.to] = m.promote ? new KINDS[m.promote](p.color) : p;
    if (p instanceof King) {
      this.kings[p.color] = m.to;
      if (Math.abs(m.to - m.from) === 2) {
        const [a, b] = m.to > m.from ? [m.to + 1, m.to - 1] : [m.to - 2, m.to + 1];
        this.at[b] = this.at[a];
        this.at[a] = null;
        undo.rook = [a, b];
      }
    }
    if (p instanceof Pawn && m.to === this.passing) {
      undo.en = m.to - p.forward;
      undo.taken = this.at[undo.en];
      this.at[undo.en] = null;
    }
    const lost = {
      60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q"
  };
    let castles = this.castles;
    for (const s of [m.from, m.to]) if (lost[s] && [...lost[s]].some(c => castles.has(c))) {
      castles = new Set([...castles].filter(c => !lost[s].includes(c)));
    }
    this.castles = castles;
    this.passing = p instanceof Pawn &&
      Math.abs(m.to - m.from) === 16 ? m.from + p.forward : -1;
    this.half = p instanceof Pawn || undo.taken ? 0 : this.half + 1;
    if (this.turn < 0) this.full++;
    this.turn = -this.turn;
    this.past.push(undo);
  }
  undo() {
    const u = this.past.pop();
    this.turn = -this.turn;
    if (this.turn < 0) this.full--;
    this.at[u.m.from] = u.p;
    this.at[u.m.to] = u.en >= 0 ? null : u.taken;
    if (u.en >= 0) this.at[u.en] = u.taken;
    if (u.p instanceof King) this.kings[u.p.color] = u.m.from;
    if (u.rook) {
      this.at[u.rook[0]] = this.at[u.rook[1]];
      this.at[u.rook[1]] = null;
    }
    this.castles = u.castles;
    this.passing = u.passing;
    this.half = u.half;
  }
  legal() {
    const out = [];
    for (const m of this.pseudo()) {
      this.play(m);
      if (!this.attacked(this.kings[-this.turn], this.turn)) out.push(m);
      this.undo();
    }
    return out;
  }
  count(depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of this.legal()) {
      if (depth === 1) {
        n++;
        continue;
      }
      this.play(m);
      n += this.count(depth - 1);
      this.undo();
    }
    return n;
  }
  get state() {
    const any = this.legal().length > 0;
    return any ? (this.half >= 100 ? "fifty" : "going") : this.check ? "mate" : "stalemate";
  }
  write(m) {
    const p = this.at[m.from], moves = this.legal();
    if (p instanceof King &&
      Math.abs(m.to - m.from) === 2) return (m.to > m.from ? "O-O" : "O-O-O") + this.#mark(m);
    let out = p instanceof Pawn ? "" : p.constructor.letter.toUpperCase();
    const others = moves.filter(o => o.to === m.to && o.from !== m.from &&
      this.at[o.from].constructor === p.constructor);
    if (!(p instanceof Pawn) &&
      others.length) out += others.every(o => (o.from & 7) !== (m.from & 7)) ? label(m.from)[0] : others.every(o => o.from >> 3 !== m.from >> 3) ? label(m.from)[1] : label(m.from);
    const takes = this.at[m.to] !== null || (p instanceof Pawn && m.to === this.passing);
    if (takes) out += (p instanceof Pawn ? label(m.from)[0] : "") + "x";
    out += label(m.to) + (m.promote ? "=" + m.promote.toUpperCase() : "");
    return out + this.#mark(m);
  }
  #mark(m) {
    this.play(m);
    const s = this.state;
    const out = s === "mate" ? "#" : this.check ? "+" : "";
    this.undo();
    return out;
  }
  read(text) {
    const m = this.legal().find(x => this.write(x) === text ||
      label(x.from) + label(x.to) + (x.promote ?? "") === text);
    if (!m) throw new SyntaxError("no move " + text);
    return m;
  }
  evaluate() {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = this.at[i];
      if (p === null) continue;
      s += p.worth + p.color * (p instanceof Pawn ? (p.color > 0 ? 7 - (i >> 3) : i >> 3) * 4 : p instanceof King ? 0 : 6 - Math.abs(3.5 - (i & 7)) - Math.abs(3.5 - (i >> 3)));
    }
    return s * this.turn;
  }
}
export class Search {
  nodes = 0;
  best(board, depth) {
    let top = null;
    const moves = board.legal().sort((a, b) => this.#guess(board, b) - this.#guess(board, a));
    let alpha = -1e9;
    for (const m of moves) {
      board.play(m);
      const score = -this.#look(board, depth - 1, -1e9, -alpha);
      board.undo();
      if (score > alpha) {
        alpha = score;
        top = m;
      }
    }
    return {
      move: top, score: alpha
  };
  }
  #guess(board, m) {
    const t = board.at[m.to];
    return (t ? t.constructor.value * 10 - board.at[m.from].constructor.value : 0) + (m.promote ? 800 : 0);
  }
  #look(board, depth, alpha, beta) {
    this.nodes++;
    const moves = board.legal();
    if (!moves.length) return board.check ? -1e6 - depth : 0;
    if (depth <= 0) return board.evaluate();
    for (const m of moves.sort((a, b) => this.#guess(board, b) - this.#guess(board, a))) {
      board.play(m);
      const score = -this.#look(board, depth - 1, -beta, -alpha);
      board.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}
