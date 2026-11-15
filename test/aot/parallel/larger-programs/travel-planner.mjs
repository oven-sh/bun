// Routes found by evolution, annealing and exact search: points, distances, populations, crossovers, mutations, a thread of random numbers, statistics, a map printed
class Random {
  #a;
  #b;
  #c;
  #d;
  constructor(seed) {
    this.#a = seed | 0;
    this.#b = 0x9e3779b9 | 0;
    this.#c = 0x243f6a88 | 0;
    this.#d = 1;
    for (let i = 0; i < 15; i++) this.next();
  }
  next() {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  pick(list) {
    return list[this.int(list.length)];
  }
  shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const k = this.int(i + 1);
      [out[i], out[k]] = [out[k], out[i]];
    }
    return out;
  }
}
class Places {
  constructor(points) {
    this.points = points;
    const n = (this.n = points.length);
    this.table = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) this.table[a * n + b] = Math.hypot(points[a].x - points[b].x,
      points[a].y - points[b].y);
    this.measured = 0;
  }
  static scatter(n, random, clusters = 0) {
    const centers = Array.from({ length: clusters }, () => ({ x: random.next() * 100,
      y: random.next() * 100 }));
    return new Places(Array.from({ length: n }, (_, i) => {
      if (!clusters) return {
        x: random.next() * 100, y: random.next() * 100, name: "p" + i
    };
      const c = random.pick(centers);
      return {
        x: c.x + (random.next() - 0.5) * 14, y: c.y + (random.next() - 0.5) * 14, name: "p" + i
    };
  }));
  }
  between(a, b) {
    return this.table[a * this.n + b];
  }
  length(tour) {
    this.measured++;
    let s = 0;
    for (let i = 0; i < tour.length; i++) s += this.table[tour[i] * this.n + tour[(i + 1) % tour.length]];
    return s;
  }
  draw(tour, width = 40, height = 14) {
    const rows = Array.from({ length: height }, () => new Array(width).fill(" "));
    const at = p => [Math.max(0, Math.min(width - 1, Math.round((p.x / 100) * (width - 1)))),
      Math.max(0, Math.min(height - 1, Math.round((p.y / 100) * (height - 1))))];
    for (let i = 0; i < tour.length; i++) {
      const [x0, y0] = at(this.points[tour[i]]), [x1,
        y1] = at(this.points[tour[(i + 1) % tour.length]]);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / steps),
          y = Math.round(y0 + ((y1 - y0) * k) / steps);
        if (rows[y][x] === " ") rows[y][x] = ".";
      }
    }
    for (const p of this.points) {
      const [x, y] = at(p);
      rows[y][x] = "o";
    }
    return rows.map(r => r.join("").trimEnd()).join("\n");
  }
}
class Tour {
  constructor(places, order) {
    this.places = places;
    this.order = order;
    this._length = null;
  }
  get length() {
    return (this._length ??= this.places.length(this.order));
  }
  copy() {
    const t = new Tour(this.places, this.order.slice());
    t._length = this._length;
    return t;
  }
  get valid() {
    return new Set(this.order).size === this.places.n && this.order.length === this.places.n;
  }
  reverse(i, k) {
    const o = this.order;
    while (i < k) {
      const t = o[i];
      o[i++] = o[k];
      o[k--] = t;
    }
  }
  twoOpt(limit = Infinity) {
    const o = this.order, n = o.length, p = this.places;
    let better = true, rounds = 0, moves = 0;
    while (better && rounds++ < limit) {
      better = false;
      for (let i = 0; i < n - 1; i++) for (let k = i + 2; k < n; k++) {
        if (i === 0 && k === n - 1) continue;
        const a = o[i], b = o[i + 1], c = o[k], d = o[(k + 1) % n];
        const change = p.between(a, c) + p.between(b, d) - p.between(a, b) - p.between(c, d);
        if (change < -1e-9) {
          this.reverse(i + 1, k);
          better = true;
          moves++;
        }
      }
    }
    this._length = null;
    return moves;
  }
  orOpt() {
    const n = this.order.length, p = this.places;
    let moves = 0;
    for (let size = 1; size <= 3; size++) for (let i = 0; i < n; i++) {
      const o = this.order;
      const part = Array.from({ length: size }, (_, k) => o[(i + k) % n]);
      const before = o[(i + n - 1) % n], after = o[(i + size) % n];
      const saved = p.between(before, part[0]) + p.between(part[size - 1],
        after) - p.between(before, after);
      if (saved < 1e-9) continue;
      const rest = o.filter(x => !part.includes(x));
      let best = null;
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k], b = rest[(k + 1) % rest.length];
        const cost = p.between(a, part[0]) + p.between(part[size - 1], b) - p.between(a, b);
        if (cost < saved - 1e-9 && (!best || cost < best.cost)) best = {
          cost, k
      };
      }
      if (best) {
        rest.splice(best.k + 1, 0, ...part);
        this.order = rest;
        moves++;
      }
    }
    this._length = null;
    return moves;
  }
  toString() {
    return this.length.toFixed(6);
  }
}
class Solver {
  constructor(places, random) {
    this.places = places;
    this.random = random;
    this.history = [];
  }
  get label() {
    return this.constructor.name;
  }
  solve() {
    throw new TypeError(this.label + " has no solve");
  }
  random_() {
    return new Tour(this.places, this.random.shuffle(Array.from({ length: this.places.n }, (_,
      i) => i)));
  }
}
class Nearest extends Solver {
  solve(start = 0) {
    const left = new Set(Array.from({ length: this.places.n }, (_, i) => i));
    const order = [start];
    left.delete(start);
    while (left.size) {
      const at = order[order.length - 1];
      let best = -1;
      for (const c of left) if (best < 0 || this.places.between(at,
        c) < this.places.between(at, best)) best = c;
      order.push(best);
      left.delete(best);
    }
    return new Tour(this.places, order);
  }
}
class Insertion extends Solver {
  solve() {
    const todo = this.random.shuffle(Array.from({ length: this.places.n }, (_, i) => i));
    const order = todo.splice(0, 3);
    for (const c of todo) {
      let best = 0, cost = Infinity;
      for (let i = 0; i < order.length; i++) {
        const a = order[i], b = order[(i + 1) % order.length], d = this.places.between(a,
          c) + this.places.between(c, b) - this.places.between(a, b);
        if (d < cost) {
          cost = d;
          best = i;
        }
      }
      order.splice(best + 1, 0, c);
    }
    return new Tour(this.places, order);
  }
}
class Spanning extends Solver {
  solve() {
    const n = this.places.n, parent = new Int32Array(n).fill(-1),
      key = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
    key[0] = 0;
    const kids = Array.from({ length: n }, () => []);
    for (let r = 0; r < n; r++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || key[i] < key[u])) u = i;
      done[u] = 1;
      if (parent[u] >= 0) kids[parent[u]].push(u);
      for (let v = 0; v < n; v++) if (!done[v] && this.places.between(u, v) < key[v]) {
        key[v] = this.places.between(u, v);
        parent[v] = u;
      }
    }
    this.bound = key.reduce((a, b) => a + b, 0);
    const order = [];
    (function walk(u) {
      order.push(u);
      for (const v of kids[u]) walk(v);
  })(0);
    return new Tour(this.places, order);
  }
}
class Annealing extends Solver {
  solve({ rounds = 30000, hot = 40, cold = 0.05 } = {}) {
    let tour = this.random_(), length = tour.length, best = tour.copy();
    const n = this.places.n, p = this.places;
    this.accepted = 0;
    for (let r = 0; r < rounds; r++) {
      const heat = hot * Math.pow(cold / hot, r / rounds);
      let i = this.random.int(n), k = this.random.int(n);
      if (i > k) [i, k] = [k, i];
      if (k - i < 1 || (i === 0 && k === n - 1)) continue;
      const o = tour.order, a = o[(i + n - 1) % n], b = o[i], c = o[k], d = o[(k + 1) % n];
      const change = p.between(a, c) + p.between(b, d) - p.between(a, b) - p.between(c, d);
      if (change < 0 || this.random.next() < Math.exp(-change / heat)) {
        tour.reverse(i, k);
        length += change;
        this.accepted++;
        if (length < best.length - 1e-9) {
          best = new Tour(p, tour.order.slice());
        }
      }
      if (r % 5000 === 0) this.history.push(+length.toFixed(3));
    }
    return best;
  }
}
const crossovers = {
  order(a, b, random) {
    const n = a.length;
    let i = random.int(n), k = random.int(n);
    if (i > k) [i, k] = [k, i];
    const part = a.slice(i, k + 1), used = new Set(part);
    const rest = b.filter(x => !used.has(x));
    return [...rest.slice(0, i), ...part, ...rest.slice(i)];
}, edges(a, b, random) {
    const near = new Map();
    for (const t of [a, b]) t.forEach((c, i) => {
      const s = near.get(c) ?? near.set(c, new Set()).get(c);
      s.add(t[(i + 1) % t.length]).add(t[(i + t.length - 1) % t.length]);
  });
    const out = [];
    let at = random.pick(a);
    while (out.length < a.length) {
      out.push(at);
      for (const s of near.values()) s.delete(at);
      let next = -1;
      for (const c of near.get(at)) if (next < 0 || near.get(c).size < near.get(next).size ||
        (near.get(c).size === near.get(next).size && c < next)) next = c;
      near.delete(at);
      if (next < 0) next = near.size ? random.pick([...near.keys()]) : -1;
      at = next;
    }
    return out;
  }
};
class Evolution extends Solver {
  solve({ size = 40, generations = 60, crossover = "order", mutation = 0.3, elite = 2 } = {}) {
    const cross = crossovers[crossover];
    if (!cross) throw new ReferenceError("no crossover " + crossover);
    let people = Array.from({ length: size }, () => this.random_());
    const pick = () => {
      let best = this.random.pick(people);
      for (let i = 0; i < 2; i++) {
        const o = this.random.pick(people);
        if (o.length < best.length) best = o;
      }
      return best;
  };
    for (let g = 0; g < generations; g++) {
      people.sort((x, y) => x.length - y.length);
      if (g % 10 === 0) this.history.push(+people[0].length.toFixed(3));
      const next = people.slice(0, elite);
      while (next.length < size) {
        const child = new Tour(this.places, cross(pick().order, pick().order, this.random));
        if (this.random.next() < mutation) {
          let i = this.random.int(this.places.n), k = this.random.int(this.places.n);
          if (i > k) [i, k] = [k, i];
          child.reverse(i, k);
        }
        next.push(child);
      }
      people = next;
    }
    people.sort((x, y) => x.length - y.length);
    return people[0];
  }
}
class Exact extends Solver {
  solve() {
    const n = this.places.n;
    if (n > 14) throw new RangeError("too many places: " + n);
    const full = 1 << (n - 1), best = new Float64Array(full * (n - 1)).fill(Infinity),
      from = new Int8Array(full * (n - 1)).fill(-1);
    this.states = 0;
    for (let i = 0; i < n - 1; i++) best[(1 << i) * (n - 1) + i] = this.places.between(0,
      i + 1);
    for (let set = 1; set < full; set++) for (let last = 0; last < n - 1; last++) {
      const cost = best[set * (n - 1) + last];
      if (!(set & (1 << last)) || cost === Infinity) continue;
      this.states++;
      for (let next = 0; next < n - 1; next++) {
        if (set & (1 << next)) continue;
        const to = (set | (1 << next)) * (n - 1) + next,
          c = cost + this.places.between(last + 1, next + 1);
        if (c < best[to]) {
          best[to] = c;
          from[to] = last;
        }
      }
    }
    let last = 0;
    for (let i = 1; i < n - 1; i++) if (best[(full - 1) * (n - 1) + i] + this.places.between(i + 1,
      0) < best[(full - 1) * (n - 1) + last] + this.places.between(last + 1, 0)) last = i;
    const order = [];
    for (let set = full - 1; last >= 0; ) {
      order.push(last + 1);
      const prev = from[set * (n - 1) + last];
      set &= ~(1 << last);
      last = prev;
    }
    order.push(0);
    return new Tour(this.places, order.reverse());
  }
}
const summary = list => {
  const sorted = [...list].sort((a, b) => a - b), mean = list.reduce((a, b) => a + b,
    0) / list.length;
  return {
    n: list.length, min: +sorted[0].toFixed(4), middle: +sorted[sorted.length >> 1].toFixed(4),
      mean: +mean.toFixed(4), spread: +Math.sqrt(list.reduce((s, v) => s + (v - mean) ** 2,
      0) / list.length).toFixed(4)
};
};
for (const [n, clusters, seed] of [[9, 0, 1], [30, 0, 7], [60, 5, 11]]) {
  const random = new Random(seed), places = Places.scatter(n, random, clusters);
  const rows = [];
  for (const K of [Nearest, Insertion, Spanning]) {
    const s = new K(places, random);
    const t = s.solve();
    const before = t.length;
    const moves = t.twoOpt() + t.orOpt() + t.twoOpt();
    rows.push(`${s.label} ${before.toFixed(3)}>${t.length.toFixed(3)} (${moves}) ${t.valid}${s.bound ? " bound " + s.bound.toFixed(3) : ""}`);
  }
  const a = new Annealing(places, random), at = a.solve({ rounds: 20000 });
  rows.push(`${a.label} ${at} ${a.accepted} ${a.history.join()} ${at.valid}`);
  for (const crossover of ["order", "edges"]) {
    const e = new Evolution(places, random), et = e.solve({ crossover, generations: 40 });
    rows.push(`${crossover} ${et} ${e.history.join()} ${et.valid}`);
  }
  if (n < 12) {
    const x = new Exact(places, random), xt = x.solve();
    rows.push(`${x.label} ${xt} ${x.states} ${xt.order.join()}`);
  }
  console.log(n, places.measured, rows.join("\n  "));
  if (n === 30) console.log(places.draw(at.order));
}
const lengths = [];
for (let i = 0; i < 25; i++) {
  const r = new Random(100 + i), p = Places.scatter(25, r, i % 3);
  const t = new Nearest(p, r).solve(i % 25);
  t.twoOpt();
  lengths.push(t.length);
}
console.log(JSON.stringify(summary(lengths)));
for (const bad of [() => new Exact(Places.scatter(20, new Random(1)), new Random(1)).solve(),
  () => new Evolution(Places.scatter(5, new Random(1)),
  new Random(1)).solve({ crossover: "none" }), () => new Solver(null, null).solve()]) try {
  bad();
} catch (e) {
  console.log(e.name, e.message);
}
