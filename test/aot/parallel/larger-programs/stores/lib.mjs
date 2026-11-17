// Stores: least recently and least frequently used with limits by count, size and age, tries by letters and by longest prefix, a sorted list of levels, a filter that may say yes, intervals, a log with a snapshot
export class Recent {
  #map = new Map();
  #head = {
    key: null, prev: null, next: null
};
  hits = 0;
  misses = 0;
  evicted = [];
  constructor({ max = 10, size = () => 1, age = Infinity, now = () => 0,
    onEvict = null } = {}) {
    Object.assign(this, { max, sizeOf: size, age, now, onEvict });
    this.#head.prev = this.#head.next = this.#head;
    this.total = 0;
  }
  #unlink(n) {
    n.prev.next = n.next;
    n.next.prev = n.prev;
  }
  #front(n) {
    n.next = this.#head.next;
    n.prev = this.#head;
    this.#head.next.prev = n;
    this.#head.next = n;
  }
  #drop(n, why) {
    this.#unlink(n);
    this.#map.delete(n.key);
    this.total -= n.size;
    this.evicted.push(why + ":" + String(n.key));
    this.onEvict?.(n.key, n.value, why);
  }
  get(key) {
    const n = this.#map.get(key);
    if (!n) {
      this.misses++;
      return undefined;
    }
    if (this.now() - n.at > this.age) {
      this.#drop(n, "age");
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.#unlink(n);
    this.#front(n);
    return n.value;
  }
  peek(key) {
    return this.#map.get(key)?.value;
  }
  set(key, value) {
    const size = this.sizeOf(value, key);
    if (size > this.max) throw new RangeError(`${String(key)} needs ${size}`);
    let n = this.#map.get(key);
    if (n) {
      this.total += size - n.size;
      n.value = value;
      n.size = size;
      n.at = this.now();
      this.#unlink(n);
  } else {
      n = {
        key, value, size, at: this.now(), prev: null, next: null
    };
      this.#map.set(key, n);
      this.total += size;
    }
    this.#front(n);
    while (this.total > this.max) this.#drop(this.#head.prev, "full");
    return this;
  }
  delete(key) {
    const n = this.#map.get(key);
    if (!n) return false;
    this.#drop(n, "gone");
    return true;
  }
  get size() {
    return this.#map.size;
  }
  *[Symbol.iterator]() {
    for (let n = this.#head.next; n !== this.#head; n = n.next) yield [n.key, n.value];
  }
}
export class Frequent {
  constructor(max) {
    this.max = max;
    this.values = new Map();
    this.counts = new Map();
    this.lists = new Map();
    this.least = 0;
  }
  #touch(key) {
    const c = this.counts.get(key) ?? 0;
    this.counts.set(key, c + 1);
    const from = this.lists.get(c);
    if (from) {
      from.delete(key);
      if (!from.size) {
        this.lists.delete(c);
        if (this.least === c) this.least = c + 1;
      }
    }
    let to = this.lists.get(c + 1);
    if (!to) this.lists.set(c + 1, (to = new Set()));
    to.add(key);
  }
  get(key) {
    if (!this.values.has(key)) return undefined;
    this.#touch(key);
    return this.values.get(key);
  }
  set(key, value) {
    if (this.max <= 0) return this;
    if (!this.values.has(key) && this.values.size >= this.max) {
      const list = this.lists.get(this.least);
      const [old] = list;
      list.delete(old);
      if (!list.size) this.lists.delete(this.least);
      this.values.delete(old);
      this.counts.delete(old);
    }
    const fresh = !this.values.has(key);
    this.values.set(key, value);
    this.#touch(key);
    if (fresh) this.least = 1;
    return this;
  }
  toString() {
    return [...this.values.keys()].map(k => k + "x" + this.counts.get(k)).join();
  }
}
export class Node {
  constructor() {
    this.next = new Map();
    this.value = undefined;
    this.count = 0;
    this.end = false;
  }
}
export class Trie {
  #root = new Node();
  nodes = 1;
  constructor(entries = []) {
    for (const [k, v] of entries) this.set(k, v);
  }
  get size() {
    return this.#root.count;
  }
  #find(prefix) {
    let n = this.#root;
    for (const c of prefix) {
      n = n.next.get(c);
      if (!n) return null;
    }
    return n;
  }
  set(key, value) {
    const had = this.has(key);
    let n = this.#root;
    if (!had) n.count++;
    for (const c of key) {
      let m = n.next.get(c);
      if (!m) {
        n.next.set(c, (m = new Node()));
        this.nodes++;
      }
      n = m;
      if (!had) n.count++;
    }
    n.end = true;
    n.value = value;
    return this;
  }
  get(key) {
    const n = this.#find(key);
    return n?.end ? n.value : undefined;
  }
  has(key) {
    return this.#find(key)?.end ?? false;
  }
  delete(key) {
    if (!this.has(key)) return false;
    let n = this.#root;
    n.count--;
    for (const c of key) {
      const m = n.next.get(c);
      if (--m.count === 0) {
        const drop = x => {
          this.nodes--;
          for (const y of x.next.values()) drop(y);
      };
        drop(m);
        n.next.delete(c);
        return true;
      }
      n = m;
    }
    n.end = false;
    n.value = undefined;
    return true;
  }
  *entries(prefix = "") {
    const start = this.#find(prefix);
    if (!start) return;
    const walk = function* (n, key) {
      if (n.end) yield [key, n.value];
      for (const c of [...n.next.keys()].sort()) yield* walk(n.next.get(c), key + c);
  };
    yield* walk(start, prefix);
} [Symbol.iterator]() {
    return this.entries();
  }
  count(prefix) {
    return this.#find(prefix)?.count ?? 0;
  }
  longest(text) {
    let n = this.#root, best = null, key = "";
    for (const c of text) {
      if (n.end) best = [key, n.value];
      n = n.next.get(c);
      if (!n) return best;
      key += c;
    }
    return n.end ? [key, n.value] : best;
  }
  near(word, far = 1) {
    const out = [];
    const walk = (n, key, row) => {
      if (n.end && row.at(-1) <= far) out.push(key + ":" + row.at(-1));
      if (Math.min(...row) > far) return;
      for (const [c, m] of n.next) {
        const next = [row[0] + 1];
        for (let i = 1; i < row.length; i++) next.push(Math.min(next[i - 1] + 1, row[i] + 1,
          row[i - 1] + (word[i - 1] === c ? 0 : 1)));
        walk(m, key + c, next);
      }
  };
    walk(this.#root, "", Array.from({ length: word.length + 1 }, (_, i) => i));
    return out.sort();
  }
}
export class Levels {
  constructor(compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0), seed = 1) {
    this.compare = compare;
    this.head = {
      key: undefined, value: undefined, next: new Array(12).fill(null),
        width: new Array(12).fill(1)
  };
    this.level = 1;
    this.size = 0;
    this.seed = seed;
    this.steps = 0;
  }
  #height() {
    let h = 1;
    while (h < 12 && (this.seed = (this.seed * 48271) % 2147483647) % 2 === 0) h++;
    return h;
  }
  #path(key) {
    const path = new Array(12).fill(this.head), ranks = new Array(12).fill(0);
    let n = this.head, rank = 0;
    for (let l = this.level - 1; l >= 0; l--) {
      while (n.next[l] && this.compare(n.next[l].key, key) < 0) {
        rank += n.width[l];
        n = n.next[l];
        this.steps++;
      }
      path[l] = n;
      ranks[l] = rank;
    }
    return {
      path, ranks, node: n.next[0]
  };
  }
  get(key) {
    const {
      node
  } = this.#path(key);
    return node && this.compare(node.key, key) === 0 ? node.value : undefined;
  }
  set(key, value) {
    const {
      path, ranks, node
  } = this.#path(key);
    if (node && this.compare(node.key, key) === 0) {
      node.value = value;
      return false;
    }
    const h = this.#height();
    for (; this.level < h; this.level++) {
      path[this.level] = this.head;
      ranks[this.level] = 0;
      this.head.width[this.level] = this.size + 1;
    }
    const fresh = {
      key, value, next: [], width: []
  };
    for (let l = 0; l < this.level; l++) {
      if (l < h) {
        fresh.next[l] = path[l].next[l];
        path[l].next[l] = fresh;
        const before = ranks[0] - ranks[l] + 1;
        fresh.width[l] = path[l].width[l] - before + 1;
        path[l].width[l] = before;
    } else path[l].width[l]++;
    }
    this.size++;
    return true;
  }
  delete(key) {
    const {
      path, node
  } = this.#path(key);
    if (!node || this.compare(node.key, key) !== 0) return false;
    for (let l = 0; l < this.level; l++) if (path[l].next[l] === node) {
      path[l].width[l] += node.width[l] - 1;
      path[l].next[l] = node.next[l];
  } else path[l].width[l]--;
    while (this.level > 1 && !this.head.next[this.level - 1]) this.level--;
    this.size--;
    return true;
  }
  at(i) {
    if (i < 0 || i >= this.size) return undefined;
    let n = this.head, left = i + 1;
    for (let l = this.level - 1; l >= 0; l--) while (n.next[l] && n.width[l] <= left) {
      left -= n.width[l];
      n = n.next[l];
    }
    return n.key;
  }
  rank(key) {
    return this.#path(key).ranks[0];
  }
  *range(from, to) {
    for (let n = this.#path(from).node; n && this.compare(n.key,
      to) < 0; n = n.next[0]) yield [n.key, n.value];
  }
}
export class Maybe {
  constructor(bits, hashes) {
    this.bits = new Uint32Array((bits + 31) >> 5);
    this.n = bits;
    this.hashes = hashes;
  }
  *#places(text) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = (Math.imul(b, 33) + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < this.hashes; i++) yield ((a >>> 0) + i * ((b >>> 0) | 1)) % this.n;
  }
  add(text) {
    for (const p of this.#places(text)) this.bits[p >>> 5] |= 1 << (p & 31);
    return this;
  }
  has(text) {
    for (const p of this.#places(text)) if (!(this.bits[p >>> 5] & (1 << (p & 31)))) return false;
    return true;
  }
  get full() {
    let n = 0;
    for (let w of this.bits) {
      w >>>= 0;
      while (w) {
        n += w & 1;
        w >>>= 1;
      }
    }
    return n / this.n;
  }
}
export class Intervals {
  #list = [];
  add(from, to) {
    if (!(from < to)) throw new RangeError(`bad interval ${from}..${to}`);
    const out = [];
    for (const [a, b] of this.#list) {
      if (b < from || a > to) out.push([a, b]);
      else {
        from = Math.min(from, a);
        to = Math.max(to, b);
      }
    }
    out.push([from, to]);
    this.#list = out.sort((x, y) => x[0] - y[0]);
    return this;
  }
  remove(from, to) {
    this.#list = this.#list.flatMap(([a, b]) => (b <= from || a >= to ? [[a, b]] : [[a, from],
      [to, b]].filter(([x, y]) => x < y)));
    return this;
  }
  has(x) {
    let lo = 0, hi = this.#list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#list[mid][1] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.#list.length && this.#list[lo][0] <= x;
  }
  get length() {
    return this.#list.reduce((s, [a, b]) => s + b - a, 0);
  }
  toString() {
    return this.#list.map(i => i.join("..")).join(" ");
  }
  gaps(from, to) {
    const out = [];
    let at = from;
    for (const [a, b] of this.#list) {
      if (a > at && at < to) out.push([at, Math.min(a, to)]);
      at = Math.max(at, b);
    }
    if (at < to) out.push([at, to]);
    return out;
  }
}
export class Log {
  #entries = [];
  #snapshot = {
    at: 0, state: {
    }
};
  constructor(apply, every = 50) {
    this.apply = apply;
    this.every = every;
    this.replayed = 0;
  }
  append(entry) {
    this.#entries.push(Object.freeze({ ...entry, n: this.#entries.length }));
    if (this.#entries.length % this.every === 0) this.#snapshot = {
      at: this.#entries.length, state: this.state()
  };
    return this;
  }
  state(until = this.#entries.length) {
    let {
      at, state
  } = until >= this.#snapshot.at ? this.#snapshot : {
      at: 0, state: {
      }
  };
    state = {
      ...state
  };
    for (; at < until; at++) {
      state = this.apply(state, this.#entries[at]);
      this.replayed++;
    }
    return state;
  }
  compact() {
    const last = new Map();
    for (const e of this.#entries) last.set(e.key, e);
    const kept = [...last.values()].filter(e => e.op !== "del");
    const dropped = this.#entries.length - kept.length;
    this.#entries = kept;
    this.#snapshot = {
      at: 0, state: {
      }
  };
    return dropped;
  }
  get length() {
    return this.#entries.length;
  }
}
