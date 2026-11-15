// Generic graphs: adapters, searches as iterators, shortest paths, spanning trees, components, orders, flows, coloring, matching, a planner over a grid
interface Edge<N, E> {
  readonly from: N;
  readonly to: N;
  readonly data: E
}
type Weight<N, E> = (e: Edge<N, E>) => number;
class NegativeWeight extends RangeError {
  constructor(readonly weight: number) {
    super("negative weight " + weight);
    this.name = "NegativeWeight";
  }
}
class CycleError<N> extends Error {
  constructor(readonly path: readonly N[]) {
    super("cycle " + path.join(" > "));
    this.name = "CycleError";
  }
}
class PriorityQueue<T> {
  readonly #heap: {
    item: T;
    key: number;
    seq: number
}[] = [];
  #seq = 0;
  pushes = 0;
  get size() {
    return this.#heap.length;
  }
  #less(a: number, b: number) {
    const x = this.#heap[a], y = this.#heap[b];
    return x.key !== y.key ? x.key < y.key : x.seq < y.seq;
  }
  push(item: T, key: number) {
    this.pushes++;
    const h = this.#heap;
    h.push({ item, key, seq: this.#seq++ });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop(): {
    item: T;
    key: number
} | undefined {
    const h = this.#heap;
    if (!h.length) return undefined;
    const top = h[0], last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        const l = 2 * i + 1, r = l + 1;
        if (l < h.length && this.#less(l, m)) m = l;
        if (r < h.length && this.#less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}
class UnionFind<N> {
  readonly #parent = new Map<N, N>();
  readonly #size = new Map<N, number>();
  sets = 0;
  add(n: N) {
    if (!this.#parent.has(n)) {
      this.#parent.set(n, n);
      this.#size.set(n, 1);
      this.sets++;
    }
  }
  find(n: N): N {
    let r = n;
    while (this.#parent.get(r) !== r) r = this.#parent.get(r)!;
    while (this.#parent.get(n) !== r) {
      const up = this.#parent.get(n)!;
      this.#parent.set(n, r);
      n = up;
    }
    return r;
  }
  join(a: N, b: N): boolean {
    let x = this.find(a), y = this.find(b);
    if (x === y) return false;
    if (this.#size.get(x)! < this.#size.get(y)!) [x, y] = [y, x];
    this.#parent.set(y, x);
    this.#size.set(x, this.#size.get(x)! + this.#size.get(y)!);
    this.sets--;
    return true;
  }
}
abstract class GraphBase<N, E> {
  abstract nodes(): Iterable<N>;
  abstract out(n: N): Iterable<Edge<N, E>>;
  get order() {
    let n = 0;
    for (const _ of this.nodes()) n++;
    return n;
  }
  *edges(): Generator<Edge<N, E>> {
    for (const n of this.nodes()) yield* this.out(n);
  }
  *breadth(start: N): Generator<{
    node: N;
    depth: number;
    via: N | null
  }
  > {
    const seen = new Set<N>([start]);
    const queue: {
      node: N;
      depth: number;
      via: N | null
  }[] = [{ node: start, depth: 0, via: null }];
    for (let i = 0; i < queue.length; i++) {
      yield queue[i];
      for (const e of this.out(queue[i].node)) if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push({ node: e.to, depth: queue[i].depth + 1, via: e.from });
      }
    }
  }
  *depth(start: N, seen = new Set<N>()): Generator<N> {
    seen.add(start);
    yield start;
    for (const e of this.out(start)) if (!seen.has(e.to)) yield* this.depth(e.to, seen);
  }
  shortest(start: N, weight: Weight<N, E>, goal?: N,
    guess: (n: N) => number = () => 0): Paths<N> {
    const distance = new Map<N, number>([[start, 0]]), previous = new Map<N, N>(),
      done = new Set<N>();
    const queue = new PriorityQueue<N>();
    queue.push(start, guess(start));
    let visited = 0;
    for (let top = queue.pop(); top; top = queue.pop()) {
      const n = top.item;
      if (done.has(n)) continue;
      done.add(n);
      visited++;
      if (goal !== undefined && n === goal) break;
      const base = distance.get(n)!;
      for (const e of this.out(n)) {
        const w = weight(e);
        if (w < 0) throw new NegativeWeight(w);
        const d = base + w;
        if (d < (distance.get(e.to) ?? Infinity)) {
          distance.set(e.to, d);
          previous.set(e.to, n);
          queue.push(e.to, d + guess(e.to));
        }
      }
    }
    return new Paths(start, distance, previous, visited, queue.pushes);
  }
  order2(): N[] {
    const state = new Map<N, 1 | 2>(), out: N[] = [], path: N[] = [];
    const visit = (n: N) => {
      const s = state.get(n);
      if (s === 2) return;
      path.push(n);
      if (s === 1) throw new CycleError(path.slice(path.indexOf(n)));
      state.set(n, 1);
      for (const e of this.out(n)) visit(e.to);
      state.set(n, 2);
      path.pop();
      out.push(n);
  };
    for (const n of this.nodes()) visit(n);
    return out.reverse();
  }
  components(): N[][] {
    const index = new Map<N, number>(), low = new Map<N, number>(), on = new Set<N>(),
      stack: N[] = [], out: N[][] = [];
    let next = 0;
    const visit = (n: N) => {
      index.set(n, next);
      low.set(n, next++);
      stack.push(n);
      on.add(n);
      for (const { to } of this.out(n)) {
        if (!index.has(to)) {
          visit(to);
          low.set(n, Math.min(low.get(n)!, low.get(to)!));
      } else if (on.has(to)) low.set(n, Math.min(low.get(n)!, index.get(to)!));
      }
      if (low.get(n) === index.get(n)) {
        const c: N[] = [];
        for (;;) {
          const m = stack.pop()!;
          on.delete(m);
          c.push(m);
          if (m === n) break;
        }
        out.push(c);
      }
  };
    for (const n of this.nodes()) if (!index.has(n)) visit(n);
    return out;
  }
  spanning(weight: Weight<N, E>): {
    edges: Edge<N, E>[];
    total: number;
    trees: number
  }
  {
    const sets = new UnionFind<N>();
    for (const n of this.nodes()) sets.add(n);
    const edges: Edge<N, E>[] = [];
    let total = 0;
    for (const e of [...this.edges()].sort((a,
      b) => weight(a) - weight(b))) if (sets.join(e.from, e.to)) {
      edges.push(e);
      total += weight(e);
    }
    return {
      edges, total, trees: sets.sets
  };
  }
  coloring(): Map<N, number> {
    const near = new Map<N, Set<N>>();
    for (const n of this.nodes()) near.set(n, new Set());
    for (const e of this.edges()) if (e.from !== e.to) {
      near.get(e.from)!.add(e.to);
      near.get(e.to)!.add(e.from);
    }
    const colors = new Map<N, number>();
    for (const [n, around] of [...near].sort((a, b) => b[1].size - a[1].size)) {
      const used = new Set<number>();
      for (const m of around) {
        const c = colors.get(m);
        if (c !== undefined) used.add(c);
      }
      let c = 0;
      while (used.has(c)) c++;
      colors.set(n, c);
    }
    return colors;
  }
  flow(source: N, sink: N, capacity: Weight<N, E>): {
    value: number;
    rounds: number;
    cut: N[]
  }
  {
    const rest = new Map<N, Map<N, number>>();
    const add = (a: N, b: N, c: number) => {
      let m = rest.get(a);
      if (!m) rest.set(a, (m = new Map()));
      m.set(b, (m.get(b) ?? 0) + c);
  };
    for (const e of this.edges()) {
      add(e.from, e.to, capacity(e));
      add(e.to, e.from, 0);
    }
    let value = 0, rounds = 0;
    for (;;) {
      const via = new Map<N, N>();
      const queue = [source];
      for (let i = 0; i < queue.length && !via.has(sink); i++) for (const [m,
        c] of rest.get(queue[i]) ?? []) if (c > 0 && m !== source && !via.has(m)) {
        via.set(m, queue[i]);
        queue.push(m);
      }
      if (!via.has(sink)) return {
        value, rounds, cut: queue
    };
      let least = Infinity;
      for (let n = sink; n !== source; n = via.get(n)!) least = Math.min(least,
        rest.get(via.get(n)!)!.get(n)!);
      for (let n = sink; n !== source; n = via.get(n)!) {
        const p = via.get(n)!;
        rest.get(p)!.set(n, rest.get(p)!.get(n)! - least);
        rest.get(n)!.set(p, rest.get(n)!.get(p)! + least);
      }
      value += least;
      rounds++;
    }
  }
}
class Paths<N> {
  constructor(readonly start: N, readonly distance: ReadonlyMap<N, number>,
    readonly previous: ReadonlyMap<N, N>, readonly visited: number, readonly pushes: number) {
  }
  to(n: N): N[] | null {
    if (!this.distance.has(n)) return null;
    const out: N[] = [];
    for (let at: N | undefined = n; at !== undefined; at = this.previous.get(at)) out.unshift(at);
    return out;
  }
  get farthest(): [N, number] {
    let best: [N, number] = [this.start, 0];
    for (const e of this.distance) if (e[1] > best[1]) best = e;
    return best;
  }
}
class Graph<N, E> extends GraphBase<N, E> {
  readonly #out = new Map<N, Edge<N, E>[]>();
  size = 0;
  constructor(readonly directed = true) {
    super();
  }
  nodes() {
    return this.#out.keys();
  }
  out(n: N) {
    return this.#out.get(n) ?? [];
  }
  add(n: N): this {
    if (!this.#out.has(n)) this.#out.set(n, []);
    return this;
  }
  connect(from: N, to: N, data: E): this {
    this.add(from).add(to);
    this.#out.get(from)!.push({ from, to, data });
    if (!this.directed) this.#out.get(to)!.push({ from: to, to: from, data });
    this.size++;
    return this;
  }
  remove(n: N): boolean {
    if (!this.#out.delete(n)) return false;
    for (const [k, list] of this.#out) this.#out.set(k, list.filter(e => e.to !== n));
    return true;
  }
  map<F>(f: (e: Edge<N, E>) => F): Graph<N, F> {
    const g = new Graph<N, F>(true);
    for (const n of this.nodes()) g.add(n);
    for (const e of this.edges()) g.connect(e.from, e.to, f(e));
    return g;
  }
  reversed(): Graph<N, E> {
    const g = new Graph<N, E>(true);
    for (const n of this.nodes()) g.add(n);
    for (const e of this.edges()) g.connect(e.to, e.from, e.data);
    return g;
  }
}
class GridGraph extends GraphBase<number, number> {
  readonly cells: Uint8Array;
  constructor(readonly width: number, readonly height: number, fill: (x: number,
    y: number) => number) {
    super();
    this.cells = Uint8Array.from({ length: width * height }, (_, i) => fill(i % width,
      (i / width) | 0));
  }
  *nodes() {
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i]) yield i;
  }
  *out(n: number): Generator<Edge<number, number>> {
    const x = n % this.width, y = (n / this.width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= this.width || b >= this.height) continue;
      const to = b * this.width + a;
      if (this.cells[to]) yield {
        from: n, to, data: this.cells[to]
    };
    }
  }
  guess(goal: number) {
    const gx = goal % this.width, gy = (goal / this.width) | 0;
    return (n: number) => Math.abs((n % this.width) - gx) + Math.abs(((n / this.width) | 0) - gy);
  }
  draw(path: readonly number[]) {
    const on = new Set(path);
    let out = "";
    for (let i = 0; i < this.cells.length; i++) out += (on.has(i) ? "*" : this.cells[i] === 0 ? "#" : this.cells[i] > 2 ? "~" : ".") + (i % this.width === this.width - 1 ? "/" : "");
    return out;
  }
}
interface Road {
  km: number;
  lanes: number
}
const roads = new Graph<string, Road>(false);
let seed = 9;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
for (let i = 0; i < 220; i++) roads.connect("c" + random(90), "c" + random(90),
  { km: 1 + random(40), lanes: 1 + random(3) });
const km: Weight<string, Road> = e => e.data.km;
let mixed = 0;
for (let i = 0; i < 90; i++) {
  const start = "c" + i;
  if (![...roads.nodes()].includes(start)) continue;
  const p = roads.shortest(start, km);
  const [far, d] = p.farthest;
  mixed = (mixed * 31 + d + p.visited + p.pushes + (p.to(far)?.length ?? 0)) >>> 0;
  if (i < 3) console.log(start, far, d, p.to(far)!.join(">"), p.visited,
    [...roads.breadth(start)].at(-1)!.depth, [...roads.depth(start)].length);
}
console.log(mixed, roads.order, roads.size);
const tree = roads.spanning(km);
console.log(tree.total, tree.trees, tree.edges.length, new Set(roads.coloring().values()).size,
  roads.flow("c1", "c2", e => e.data.lanes).value, roads.components().length);
const tasks = new Graph<string, null>();
for (const [a, b] of [["lex", "parse"], ["parse", "check"], ["check", "emit"], ["parse",
  "print"], ["emit", "link"], ["util", "lex"], ["util", "link"]]) tasks.connect(a, b, null);
console.log(tasks.order2().join(), tasks.reversed().order2().join());
tasks.connect("link", "parse", null);
try {
  tasks.order2();
} catch (e) {
  console.log((e as Error).name, (e as Error).message, e instanceof CycleError &&
    e.path.length);
}
console.log(tasks.components().filter(c => c.length > 1).map(c => [...c].sort().join("+")).join(),
  tasks.remove("link"), tasks.remove("none"), tasks.order2().join());
try {
  roads.map(e => -e.data.km).shortest("c1", e => e.data);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
for (const [w, h] of [[24, 8], [60, 40], [110, 80]]) {
  const grid = new GridGraph(w, h, (x, y) => ((x * 7 + y * 13) % 11 < 2 && x > 0 && y > 0 &&
    x < w - 1 ? 0 : 1 + ((x * y) % 5)));
  const goal = w * h - 1;
  const plain = grid.shortest(0, e => e.data, goal), guided = grid.shortest(0, e => e.data,
    goal, grid.guess(goal));
  const path = guided.to(goal);
  console.log(w, h, plain.distance.get(goal), guided.distance.get(goal), plain.visited,
    guided.visited, path?.length, [...grid.breadth(0)].length, grid.components().length);
  if (w === 24) console.log(grid.draw(path!));
}
