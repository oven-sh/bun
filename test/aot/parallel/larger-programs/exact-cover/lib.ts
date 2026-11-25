// Dancing links: an exact cover solver with items, options and colors, used for sudoku, queens, pentominoes and word squares, with counts, limits and a generator of puzzles
export class Link {
  left: Link = this;
  right: Link = this;
  up: Link = this;
  down: Link = this;
  constructor(readonly column: Column | null, readonly row: number) {
  }
}
export class Column extends Link {
  size = 0;
  constructor(readonly name: string, readonly primary: boolean) {
    super(null, -1);
  }
}
export interface Limits {
  solutions?: number;
  nodes?: number
}
export type Choice<R> = {
  readonly row: R;
  readonly items: readonly string[]
};
export class Unsolvable extends Error {
  constructor(message: string, readonly nodes: number) {
    super(message);
    this.name = "Unsolvable";
  }
}
export class Cover<R> {
  readonly #root = new Column("root", true);
  readonly #columns = new Map<string, Column>();
  readonly #rows: {
    value: R;
    items: string[];
    first: Link | null
}[] = [];
  nodes = 0;
  updates = 0;
  constructor(primary: Iterable<string>, secondary: Iterable<string> = []) {
    for (const n of primary) this.#add(n, true);
    for (const n of secondary) this.#add(n, false);
  }
  #add(name: string, primary: boolean) {
    if (this.#columns.has(name)) throw new TypeError("item twice: " + name);
    const c = new Column(name, primary);
    this.#columns.set(name, c);
    if (primary) {
      c.left = this.#root.left;
      c.right = this.#root;
      this.#root.left.right = c;
      this.#root.left = c;
    }
  }
  get size() {
    return [this.#columns.size, this.#rows.length] as const;
  }
  option(value: R, ...items: string[]): this {
    const row = this.#rows.length;
    let first: Link | null = null;
    for (const name of items) {
      const c = this.#columns.get(name);
      if (!c) throw new ReferenceError("no item " + name);
      const l = new Link(c, row);
      l.up = c.up;
      l.down = c;
      c.up.down = l;
      c.up = l;
      c.size++;
      if (first) {
        l.left = first.left;
        l.right = first;
        first.left.right = l;
        first.left = l;
    } else first = l;
    }
    this.#rows.push({ value, items, first });
    return this;
  }
  #cover(c: Column) {
    c.right.left = c.left;
    c.left.right = c.right;
    for (let r = c.down; r !== c; r = r.down) for (let l = r.right; l !== r; l = l.right) {
      l.down.up = l.up;
      l.up.down = l.down;
      l.column!.size--;
      this.updates++;
    }
  }
  #uncover(c: Column) {
    for (let r = c.up; r !== c; r = r.up) for (let l = r.left; l !== r; l = l.left) {
      l.column!.size++;
      l.down.up = l;
      l.up.down = l;
    }
    c.right.left = c;
    c.left.right = c;
  }
  #choose(): Column | null {
    let best: Column | null = null;
    for (let c = this.#root.right as Column; c !== this.#root; c = c.right as Column) if (!best ||
      c.size < best.size) {
      best = c;
      if (c.size <= 1) break;
    }
    return best;
  }
  *solve({ solutions = Infinity, nodes = Infinity }: Limits = {}): Generator<Choice<R>[],
    void> {
    const picked: Link[] = [];
    let found = 0;
    const self = this;
    function* search(): Generator<Choice<R>[], void> {
      if (++self.nodes > nodes) throw new Unsolvable("too many nodes", self.nodes);
      const c = self.#choose();
      if (!c) {
        found++;
        yield picked.map(l => ({ row: self.#rows[l.row].value,
          items: self.#rows[l.row].items }));
        return;
      }
      if (c.size === 0) return;
      self.#cover(c);
      for (let r = c.down; r !== c; r = r.down) {
        picked.push(r);
        for (let l = r.right; l !== r; l = l.right) self.#cover(l.column!);
        yield* search();
        for (let l = r.left; l !== r; l = l.left) self.#uncover(l.column!);
        picked.pop();
        if (found >= solutions) break;
      }
      self.#uncover(c);
    }
    yield* search();
  }
  count(limits: Limits = {}): number {
    let n = 0;
    for (const _ of this.solve(limits)) n++;
    return n;
  }
}
export abstract class Puzzle<R, S> {
  abstract cover(): Cover<R>;
  abstract build(rows: Choice<R>[]): S;
  nodes = 0;
  solve(limits: Limits = {}): S | null {
    const c = this.cover();
    for (const rows of c.solve({ solutions: 1, ...limits })) {
      this.nodes = c.nodes;
      return this.build(rows);
    }
    this.nodes = c.nodes;
    return null;
  }
  count(limit = Infinity) {
    const c = this.cover(), n = c.count({ solutions: limit });
    this.nodes = c.nodes;
    return n;
  }
}
export interface Place {
  y: number;
  x: number;
  v: number
}
export class Sudoku extends Puzzle<Place, string> {
  readonly cells: readonly number[];
  readonly n: number;
  constructor(text: string, readonly box = 3) {
    super();
    this.n = box * box;
    const cells = [...text.replace(/\s/g, "")].map(c => (c === "." ||
      c === "0" ? 0 : parseInt(c, 36)));
    if (cells.length !== this.n ** 2) throw new RangeError("needs " + this.n ** 2 + " cells");
    this.cells = cells;
  }
  cover() {
    const {
      n, box
  } = this, range = Array.from({ length: n }, (_, i) => i), items: string[] = [];
    for (const a of range) for (const b of range) items.push(`p${a},${b}`, `r${a}=${b + 1}`,
      `c${a}=${b + 1}`, `b${a}=${b + 1}`);
    const cover = new Cover<Place>(items);
    for (const y of range) for (const x of range) for (let v = 1; v <= n; v++) {
      const given = this.cells[y * n + x];
      if (given && given !== v) continue;
      cover.option({ y, x, v }, `p${y},${x}`, `r${y}=${v}`, `c${x}=${v}`,
        `b${Math.floor(y / box) * box + Math.floor(x / box)}=${v}`);
    }
    return cover;
  }
  build(rows: Choice<Place>[]) {
    const out = [...this.cells];
    for (const { row: { y, x, v } } of rows) out[y * this.n + x] = v;
    return out.map(v => v.toString(36)).join("");
  }
  static make(seed: number, holes: number): string {
    let s = seed;
    const random = (n: number) => (s = (s * 48271) % 2147483647) % n;
    const base = new Sudoku(".".repeat(81));
    const start = ".".repeat(81).split("");
    for (let i = 0; i < 9; i++) start[i] = String(1 + ((i * 2 + random(9)) % 9));
    const first = [...new Set(start.slice(0, 9))];
    for (let v = 1; first.length < 9; v++) if (!first.includes(String(v))) first.push(String(v));
    const full = new Sudoku(first.join("") + ".".repeat(72)).solve();
    const cells = full!.split("");
    let left = holes;
    for (let i = 0; i < 81 && left > 0; i++) {
      const at = random(81);
      if (cells[at] === ".") continue;
      const kept = cells[at];
      cells[at] = ".";
      if (new Sudoku(cells.join("")).count(2) !== 1) cells[at] = kept;
      else left--;
    }
    void base;
    return cells.join("");
  }
}
export class Queens extends Puzzle<[number, number], string> {
  constructor(readonly n: number) {
    super();
  }
  cover() {
    const {
      n
  } = this, r = Array.from({ length: n }, (_, i) => i);
    const c = new Cover<[number, number]>([...r.map(i => "r" + i), ...r.map(i => "f" + i)],
      [...Array.from({ length: 2 * n - 1 }, (_, i) => "a" + i),
      ...Array.from({ length: 2 * n - 1 }, (_, i) => "b" + i)]);
    for (const y of r) for (const x of r) c.option([y, x], "r" + y, "f" + x, "a" + (x + y),
      "b" + (n - 1 - x + y));
    return c;
  }
  build(rows: Choice<[number, number]>[]) {
    return rows.map(c => c.row).sort((a, b) => a[0] - b[0]).map(p => p[1]).join("");
  }
}
export type Cell = readonly [number, number];
export class Pentominoes extends Puzzle<{
  piece: string;
  at: Cell[]
}, string> {
  static readonly shapes: Record<string, string> = {
    F: ".## ##. .#.", I: "#####", L: "#... ####", N: ".### ##..", P: "## ## #.",
      T: "### .#. .#.", U: "#.# ###", V: "#.. #.. ###", W: "#.. ##. .##", X: ".#. ### .#.",
      Y: ".#.. ####", Z: "##. .#. .##"
};
  static forms(text: string): Cell[][] {
    let cells: Cell[] = text.split(" ").flatMap((row, y) => [...row].flatMap((c,
      x): Cell[] => (c === "#" ? [[y, x]] : [])));
    const seen = new Map<string, Cell[]>();
    for (let m = 0; m < 2; m++) {
      for (let r = 0; r < 4; r++) {
        const y0 = Math.min(...cells.map(c => c[0])), x0 = Math.min(...cells.map(c => c[1]));
        const form = cells.map(([y, x]): Cell => [y - y0, x - x0]).sort((a,
          b) => a[0] - b[0] || a[1] - b[1]);
        seen.set(form.join(";"), form);
        cells = cells.map(([y, x]): Cell => [x, -y]);
      }
      cells = cells.map(([y, x]): Cell => [y, -x]);
    }
    return [...seen.values()];
  }
  constructor(readonly height: number, readonly width: number, readonly pieces: string,
    readonly blocked: ReadonlySet<string> = new Set()) {
    super();
  }
  cover() {
    const items: string[] = [...this.pieces];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (!this.blocked.has(`${y},${x}`)) items.push(`${y},${x}`);
    const c = new Cover<{
      piece: string;
      at: Cell[]
    }
    >(items);
    for (const piece of this.pieces) for (const form of Pentominoes.forms(Pentominoes.shapes[piece])) for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const at = form.map(([a, b]): Cell => [y + a, x + b]);
      if (at.every(([a, b]) => a < this.height && b < this.width &&
        !this.blocked.has(`${a},${b}`))) c.option({ piece, at }, piece,
        ...at.map(p => p.join()));
    }
    return c;
  }
  build(rows: Choice<{ piece: string; at: Cell[] }>[]) {
    const grid = Array.from({ length: this.height },
      () => new Array<string>(this.width).fill("."));
    for (const { row } of rows) for (const [y, x] of row.at) grid[y][x] = row.piece;
    return grid.map(r => r.join("")).join("/");
  }
}
