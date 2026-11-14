// Cells that live by their neighbors in a tree of quadrants that is shared: canonical nodes, results kept per node, steps of powers of two, patterns read from text, beside a plain grid
export abstract class Node {
  static made = 0;
  readonly id = ++Node.made;
  constructor(readonly level: number, readonly population: number) {
  }
  get size() {
    return 2 ** this.level;
  }
  abstract get(x: number, y: number): boolean;
}
export class Leaf extends Node {
  private constructor(readonly alive: boolean) {
    super(0, alive ? 1 : 0);
  }
  static readonly dead = new Leaf(false);
  static readonly live = new Leaf(true);
  get() {
    return this.alive;
  }
}
export class Quad extends Node {
  result: Node | null = null;
  step: Node | null = null;
  constructor(readonly nw: Node, readonly ne: Node, readonly sw: Node, readonly se: Node) {
    super(nw.level + 1, nw.population + ne.population + sw.population + se.population);
  }
  get(x: number, y: number): boolean {
    const half = this.size / 2;
    return (y < half ? (x < half ? this.nw : this.ne) : x < half ? this.sw : this.se).get(x % half,
      y % half);
  }
}
export class Universe {
  readonly #nodes = new Map<string, Quad>();
  readonly #empty: Node[] = [Leaf.dead];
  root: Node;
  generation = 0n;
  originX = 0;
  originY = 0;
  hits = 0;
  misses = 0;
  constructor(level = 3) {
    this.root = this.empty(level);
  }
  quad(nw: Node, ne: Node, sw: Node, se: Node): Quad {
    const key = `${nw.id},${ne.id},${sw.id},${se.id}`;
    let q = this.#nodes.get(key);
    if (q) this.hits++;
    else {
      this.misses++;
      this.#nodes.set(key, (q = new Quad(nw, ne, sw, se)));
    }
    return q;
  }
  empty(level: number): Node {
    while (this.#empty.length <= level) {
      const e = this.#empty[this.#empty.length - 1];
      this.#empty.push(this.quad(e, e, e, e));
    }
    return this.#empty[level];
  }
  get kept() {
    return this.#nodes.size;
  }
  grow() {
    const r = this.root as Quad, e = this.empty(r.level - 1);
    this.root = this.quad(this.quad(e, e, e, r.nw), this.quad(e, e, r.ne, e), this.quad(e,
      r.sw, e, e), this.quad(r.se, e, e, e));
    this.originX -= r.size / 2;
    this.originY -= r.size / 2;
  }
  #set(n: Node, x: number, y: number, alive: boolean): Node {
    if (n.level === 0) return alive ? Leaf.live : Leaf.dead;
    const q = n as Quad, half = n.size / 2;
    if (y < half) return x < half ? this.quad(this.#set(q.nw, x, y, alive), q.ne, q.sw,
      q.se) : this.quad(q.nw, this.#set(q.ne, x - half, y, alive), q.sw, q.se);
    return x < half ? this.quad(q.nw, q.ne, this.#set(q.sw, x, y - half, alive),
      q.se) : this.quad(q.nw, q.ne, q.sw, this.#set(q.se, x - half, y - half, alive));
  }
  set(x: number, y: number, alive = true): this {
    while (x < this.originX || y < this.originY || x >= this.originX + this.root.size ||
      y >= this.originY + this.root.size) this.grow();
    this.root = this.#set(this.root, x - this.originX, y - this.originY, alive);
    return this;
  }
  get(x: number, y: number): boolean {
    const a = x - this.originX, b = y - this.originY;
    return a >= 0 && b >= 0 && a < this.root.size && b < this.root.size && this.root.get(a, b);
  }
  *cells(n: Node = this.root, x = this.originX, y = this.originY): Generator<[number, number]> {
    if (n.population === 0) return;
    if (n.level === 0) {
      yield [x, y];
      return;
    }
    const q = n as Quad, half = n.size / 2;
    yield* this.cells(q.nw, x, y);
    yield* this.cells(q.ne, x + half, y);
    yield* this.cells(q.sw, x, y + half);
    yield* this.cells(q.se, x + half, y + half);
  }
  #base(q: Quad): Node {
    let bits = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (q.get(x,
      y)) bits |= 1 << (y * 4 + x);
    const next = (x: number, y: number) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx ||
        dy) n += (bits >> ((y + dy) * 4 + x + dx)) & 1;
      return n === 3 || (n === 2 && (bits >> (y * 4 + x)) & 1) ? Leaf.live : Leaf.dead;
  };
    return this.quad(next(1, 1), next(2, 1), next(1, 2), next(2, 2));
  }
  #center(n: Node): Node {
    const q = n as Quad;
    return this.quad((q.nw as Quad).se, (q.ne as Quad).sw, (q.sw as Quad).ne,
      (q.se as Quad).nw);
  }
  advance(n: Node, full: boolean): Node {
    const q = n as Quad;
    if (q.population === 0) return this.empty(q.level - 1);
    const kept = full ? q.result : q.step;
    if (kept) return kept;
    let out: Node;
    if (q.level === 2) out = this.#base(q);
    else {
      const a = q.nw as Quad, b = q.ne as Quad, c = q.sw as Quad, d = q.se as Quad;
      const n9 = [a, this.quad(a.ne, b.nw, a.se, b.sw), b, this.quad(a.sw, a.se, c.nw, c.ne),
        this.quad(a.se, b.sw, c.ne, d.nw), this.quad(b.sw, b.se, d.nw, d.ne), c,
        this.quad(c.ne, d.nw, c.se, d.sw), d];
      const r = full ? n9.map(x => this.advance(x, true)) : n9.map(x => this.advance(x, false));
      if (full) out = this.quad(this.advance(this.quad(r[0], r[1], r[3], r[4]), true),
        this.advance(this.quad(r[1], r[2], r[4], r[5]), true), this.advance(this.quad(r[3],
        r[4], r[6], r[7]), true), this.advance(this.quad(r[4], r[5], r[7], r[8]), true));
      else {
        const m = (p: Node, s: Node, t: Node, u: Node) => this.quad((p as Quad).se,
          (s as Quad).sw, (t as Quad).ne, (u as Quad).nw);
        out = q.level === 3 ? this.quad(m(r[0], r[1], r[3], r[4]), m(r[1], r[2], r[4], r[5]),
          m(r[3], r[4], r[6], r[7]), m(r[4], r[5], r[7],
          r[8])) : this.quad(this.#center(this.quad(r[0], r[1], r[3], r[4])),
          this.#center(this.quad(r[1], r[2], r[4], r[5])), this.#center(this.quad(r[3], r[4],
          r[6], r[7])), this.#center(this.quad(r[4], r[5], r[7], r[8])));
      }
    }
    if (full) q.result = out;
    else q.step = out;
    return out;
  }
  #pad() {
    for (;;) {
      const q = this.root as Quad;
      const inner = (q.nw as Quad).se as Quad,
        outside = q.population - ((q.nw as Quad).se.population + (q.ne as Quad).sw.population + (q.sw as Quad).ne.population + (q.se as Quad).nw.population);
      if (q.level >= 4 && outside === 0 && inner) return;
      this.grow();
    }
  }
  step(): this {
    this.#pad();
    this.grow();
    const size = this.root.size;
    this.root = this.advance(this.root, false);
    this.originX += size / 4;
    this.originY += size / 4;
    this.generation++;
    return this;
  }
  leap(): this {
    this.#pad();
    this.grow();
    const level = this.root.level, size = this.root.size;
    this.root = this.advance(this.root, true);
    this.originX += size / 4;
    this.originY += size / 4;
    this.generation += 2n ** BigInt(level - 2);
    return this;
  }
  get bounds(): [number, number, number, number] | null {
    let box: [number, number, number, number] | null = null;
    for (const [x, y] of this.cells()) box = box ? [Math.min(box[0], x), Math.min(box[1], y),
      Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
    return box;
  }
  text(): string {
    const b = this.bounds;
    if (!b) return "(empty)";
    let out = "";
    for (let y = b[1]; y <= b[3]; y++) {
      for (let x = b[0]; x <= b[2]; x++) out += this.get(x, y) ? "#" : ".";
      out += "/";
    }
    return out;
  }
  get hash(): number {
    let h = 0;
    for (const [x, y] of [...this.cells()].sort((a, b) => a[1] - b[1] ||
      a[0] - b[0])) h = (Math.imul(h, 31) + x * 7 + y * 13) >>> 0;
    return h;
  }
}
export class PlainLife {
  cells = new Set<string>();
  generation = 0;
  constructor(cells: Iterable<[number, number]>) {
    for (const c of cells) this.cells.add(c.join());
  }
  step(): this {
    const counts = new Map<string, number>();
    for (const c of this.cells) {
      const [x, y] = c.split(",").map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
        const k = `${x + dx},${y + dy}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const next = new Set<string>();
    for (const [k, n] of counts) if (n === 3 || (n === 2 && this.cells.has(k))) next.add(k);
    this.cells = next;
    this.generation++;
    return this;
  }
  same(u: Universe): boolean {
    let n = 0;
    for (const c of u.cells()) {
      n++;
      if (!this.cells.has(c.join())) return false;
    }
    return n === this.cells.size;
  }
}
export namespace Pattern {
  export const glider = "bob$2bo$3o!",
    gun = "24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!",
    rPent = "b2o$2o$bo!", acorn = "bo$3bo$2o2b3o!", blinker = "3o!";
  export function* parse(text: string, x0 = 0, y0 = 0): Generator<[number, number]> {
    let x = 0, y = 0, n = "";
    for (const c of text) {
      if (c >= "0" && c <= "9") {
        n += c;
        continue;
      }
      const k = n ? +n : 1;
      n = "";
      switch (c) {
        case "b": x += k;
        break;
        case "o": for (let i = 0; i < k; i++) yield [x0 + x++, y0 + y];
        break;
        case "$": y += k;
        x = 0;
        break;
        case "!": return;
        default: if (c.trim()) throw new SyntaxError("bad pattern at " + c);
      }
    }
    throw new SyntaxError("pattern does not end");
  }
  export function print(cells: Iterable<[number, number]>): string {
    const rows = new Map<number, number[]>();
    let x0 = Infinity, y0 = Infinity;
    for (const [x, y] of cells) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      const r = rows.get(y);
      if (r) r.push(x);
      else rows.set(y, [x]);
    }
    if (!rows.size) return "!";
    let out = "", last = y0;
    const run = (n: number, c: string) => {
      if (n > 0) out += (n > 1 ? n : "") + c;
  };
    for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
      run(y - last, "$");
      last = y;
      let at = x0;
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length; ) {
        run(xs[i] - at, "b");
        let n = 1;
        while (xs[i + n] === xs[i] + n) n++;
        run(n, "o");
        at = xs[i] + n;
        i += n;
      }
    }
    return out + "!";
  }
}
