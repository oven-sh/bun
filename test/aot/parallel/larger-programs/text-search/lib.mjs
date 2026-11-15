// Searching texts: five ways to find a word, many words at once, suffix arrays, wild cards, edit distance, an index with ranks, highlights
export class Pattern {
  constructor(text) {
    if (!text) throw new RangeError("an empty pattern");
    this.text = text;
    this.compared = 0;
  }
  *find(source) {
    for (let at = this.next(source, 0); at >= 0; at = this.next(source, at + 1)) yield at;
  }
  next() {
    throw new TypeError("abstract");
  }
  count(source) {
    let n = 0;
    for (const _ of this.find(source)) n++;
    return n;
  }
  get name() {
    return this.constructor.name;
  }
}
export class Naive extends Pattern {
  next(s, from) {
    const p = this.text;
    for (let i = from; i + p.length <= s.length; i++) {
      let k = 0;
      while (k < p.length && (this.compared++, s.charCodeAt(i + k) === p.charCodeAt(k))) k++;
      if (k === p.length) return i;
    }
    return -1;
  }
}
export class Prefixes extends Pattern {
  constructor(text) {
    super(text);
    const t = (this.table = new Int32Array(text.length));
    for (let i = 1, k = 0; i < text.length; ) {
      if (text[i] === text[k]) t[i++] = ++k;
      else if (k) k = t[k - 1];
      else t[i++] = 0;
    }
  }
  next(s, from) {
    const p = this.text, t = this.table;
    let k = 0;
    for (let i = from; i < s.length; ) {
      this.compared++;
      if (s[i] === p[k]) {
        i++;
        if (++k === p.length) return i - k;
    } else if (k) k = t[k - 1];
      else i++;
    }
    return -1;
  }
}
export class Skips extends Pattern {
  constructor(text) {
    super(text);
    this.last = new Map();
    for (let i = 0; i < text.length - 1; i++) this.last.set(text[i], text.length - 1 - i);
  }
  next(s, from) {
    const p = this.text, n = p.length;
    let i = from;
    while (i + n <= s.length) {
      let k = n - 1;
      while (k >= 0 && (this.compared++, s[i + k] === p[k])) k--;
      if (k < 0) return i;
      i += this.last.get(s[i + n - 1]) ?? n;
    }
    return -1;
  }
}
export class Rolling extends Pattern {
  static #base = 257;
  static #mod = 1000003;
  constructor(text) {
    super(text);
    this.high = 1;
    for (let i = 1; i < text.length; i++) this.high = (this.high * Rolling.#base) % Rolling.#mod;
    this.hash = this.#of(text, 0);
    this.false = 0;
  }
  #of(s, at) {
    let h = 0;
    for (let i = 0; i < this.text.length; i++) h = (h * Rolling.#base + s.charCodeAt(at + i)) % Rolling.#mod;
    return h;
  }
  next(s, from) {
    const n = this.text.length;
    if (from + n > s.length) return -1;
    let h = this.#of(s, from);
    for (let i = from; ; i++) {
      this.compared++;
      if (h === this.hash) {
        if (s.startsWith(this.text, i)) return i;
        this.false++;
      }
      if (i + n >= s.length) return -1;
      h = ((h + Rolling.#mod * 70000 - s.charCodeAt(i) * this.high) * Rolling.#base + s.charCodeAt(i + n)) % Rolling.#mod;
      if (h < 0) h += Rolling.#mod;
    }
  }
}
export class Masks extends Pattern {
  constructor(text) {
    super(text.slice(0, 30));
    this.masks = new Map();
    for (let i = 0; i < this.text.length; i++) this.masks.set(this.text[i],
      (this.masks.get(this.text[i]) ?? 0) | (1 << i));
  }
  next(s, from) {
    const end = 1 << (this.text.length - 1);
    let state = 0;
    for (let i = from; i < s.length; i++) {
      this.compared++;
      state = ((state << 1) | 1) & (this.masks.get(s[i]) ?? 0);
      if (state & end) return i - this.text.length + 1;
    }
    return -1;
  }
}
export class TrieNode {
  next = new Map();
  words = [];
  fail = null;
  out = null;
  depth;
  constructor(depth) {
    this.depth = depth;
    TrieNode.made++;
  }
  static made = 0;
}
export class ManyWords {
  #root = new TrieNode(0);
  #built = false;
  constructor(words = []) {
    for (const w of words) this.add(w);
  }
  add(word) {
    let n = this.#root;
    for (const c of word) {
      let m = n.next.get(c);
      if (!m) n.next.set(c, (m = new TrieNode(n.depth + 1)));
      n = m;
    }
    if (!n.words.includes(word)) n.words.push(word);
    this.#built = false;
    return this;
  }
  #build() {
    const queue = [...this.#root.next.values()];
    for (const n of queue) n.fail = this.#root;
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      for (const [c, m] of n.next) {
        let f = n.fail;
        while (f && !f.next.has(c)) f = f === this.#root ? null : f.fail;
        m.fail = f ? f.next.get(c) : this.#root;
        m.out = m.fail.words.length ? m.fail : m.fail.out;
        queue.push(m);
      }
    }
    this.#built = true;
  }
  *scan(text) {
    if (!this.#built) this.#build();
    let n = this.#root;
    let i = 0;
    for (const c of text) {
      while (n !== this.#root && !n.next.has(c)) n = n.fail;
      n = n.next.get(c) ?? this.#root;
      i += c.length;
      for (let m = n.words.length ? n : n.out; m; m = m.out) for (const w of m.words) yield {
        word: w, at: i - w.length
    };
    }
  }
  has(word) {
    let n = this.#root;
    for (const c of word) {
      n = n.next.get(c);
      if (!n) return false;
    }
    return n.words.length > 0;
  }
  *starting(prefix) {
    let n = this.#root;
    for (const c of prefix) {
      n = n.next.get(c);
      if (!n) return;
    }
    const stack = [n];
    while (stack.length) {
      const m = stack.pop();
      yield* m.words;
      stack.push(...[...m.next].sort(([a], [b]) => (a < b ? 1 : -1)).map(e => e[1]));
    }
  }
  replace(text, f) {
    const found = [...this.scan(text)].sort((a, b) => a.at - b.at ||
      b.word.length - a.word.length);
    let out = "", at = 0;
    for (const { word, at: p } of found) {
      if (p < at) continue;
      out += text.slice(at, p) + f(word);
      at = p + word.length;
    }
    return out + text.slice(at);
  }
}
export class SuffixArray {
  constructor(text) {
    this.text = text;
    const n = text.length;
    let rank = Int32Array.from(text, c => c.charCodeAt(0)),
      order = Int32Array.from({ length: n }, (_, i) => i), next = new Int32Array(n);
    this.rounds = 0;
    for (let k = 1; n > 1; k *= 2) {
      this.rounds++;
      const r = rank;
      const key = i => (i + k < n ? r[i + k] : -1);
      order.sort((a, b) => r[a] - r[b] || key(a) - key(b));
      next = new Int32Array(n);
      for (let i = 1; i < n; i++) next[order[i]] = next[order[i - 1]] + (r[order[i]] !== r[order[i - 1]] ||
        key(order[i]) !== key(order[i - 1]) ? 1 : 0);
      rank = next;
      if (rank[order[n - 1]] === n - 1) break;
    }
    this.order = order;
    this.rank = rank;
  }
  get common() {
    const {
      text, order, rank
  } = this, n = text.length, out = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (rank[i] === 0) {
        k = 0;
        continue;
      }
      const j = order[rank[i] - 1];
      while (i + k < n && j + k < n && text[i + k] === text[j + k]) k++;
      out[rank[i]] = k;
      if (k) k--;
    }
    return out;
  }
  find(p) {
    const bound = low => {
      let a = 0, b = this.order.length;
      while (a < b) {
        const m = (a + b) >> 1, s = this.text.substr(this.order[m], p.length);
        if (low ? s < p : s <= p) a = m + 1;
        else b = m;
      }
      return a;
  };
    return Array.from(this.order.slice(bound(true), bound(false))).sort((a, b) => a - b);
  }
  longestRepeat() {
    const c = this.common;
    let at = 0;
    for (let i = 1; i < c.length; i++) if (c[i] > c[at]) at = i;
    return this.text.substr(this.order[at], c[at]);
  }
  distinct() {
    const n = this.text.length;
    return (n * (n + 1)) / 2 - this.common.reduce((a, b) => a + b, 0);
  }
}
export const wild = (pattern, text) => {
  let p = 0, t = 0, star = -1, mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
  } else if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = t;
  } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
  } else return false;
} while (pattern[p] === "*") p++;
  return p === pattern.length;
};
export class Speller {
  #words = new Map();
  #tree = null;
  constructor(text) {
    for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) this.#words.set(w,
      (this.#words.get(w) ?? 0) + 1);
    for (const w of this.#words.keys()) this.#insert(w);
    this.asked = 0;
  }
  static distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let k = 1; k <= b.length; k++) next.push(Math.min(row[k] + 1, next[k - 1] + 1,
        row[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)));
      row = next;
    }
    return row[b.length];
  }
  #insert(w) {
    if (!this.#tree) {
      this.#tree = {
        w, kids: new Map()
    };
      return;
    }
    let n = this.#tree;
    for (;;) {
      const d = Speller.distance(w, n.w);
      if (d === 0) return;
      const k = n.kids.get(d);
      if (!k) {
        n.kids.set(d, { w, kids: new Map() });
        return;
      }
      n = k;
    }
  }
  near(w, limit) {
    const out = [];
    const visit = n => {
      this.asked++;
      const d = Speller.distance(w, n.w);
      if (d <= limit) out.push({ w: n.w, d, n: this.#words.get(n.w) });
      for (const [k, m] of n.kids) if (k >= d - limit && k <= d + limit) visit(m);
  };
    if (this.#tree) visit(this.#tree);
    return out.sort((a, b) => a.d - b.d || b.n - a.n || (a.w < b.w ? -1 : 1));
  }
  correct(text) {
    return text.replace(/[a-z]+/gi, w => {
      const l = w.toLowerCase();
      if (this.#words.has(l)) return w;
      const best = this.near(l, 2)[0];
      return best ? "[" + best.w + "]" : w + "?";
  });
  }
  get size() {
    return this.#words.size;
  }
}
export class Index {
  #docs = [];
  #terms = new Map();
  static stop = new Set(["the", "a", "of", "and", "in", "to"]);
  static tokens(text) {
    const out = [];
    for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) if (!Index.stop.has(m[0])) out.push({ term: m[0].replace(/(ing|ed|es|s)$/,
      ""), at: m.index, end: m.index + m[0].length });
    return out;
  }
  add(title, text) {
    const id = this.#docs.length, tokens = Index.tokens(text);
    this.#docs.push({ title, text, length: tokens.length });
    tokens.forEach(({ term, at, end }, i) => {
      let t = this.#terms.get(term);
      if (!t) this.#terms.set(term, (t = new Map()));
      const p = t.get(id);
      if (p) p.push({ i, at, end });
      else t.set(id, [{ i, at, end }]);
  });
    return id;
  }
  search(query, limit = 5) {
    const phrases = [...query.matchAll(/"([^"]+)"/g)].map(m => Index.tokens(m[1]).map(t => t.term)),
      without = [...query.matchAll(/-(\w+)/g)].map(m => Index.tokens(m[1])[0]?.term),
      words = Index.tokens(query.replace(/"[^"]*"|-\w+/g, " ")).map(t => t.term);
    const scores = new Map(), N = this.#docs.length, mean = this.#docs.reduce((s,
      d) => s + d.length, 0) / N;
    for (const term of [...words, ...phrases.flat()]) {
      const t = this.#terms.get(term);
      if (!t) continue;
      const idf = Math.log(1 + (N - t.size + 0.5) / (t.size + 0.5));
      for (const [id, places] of t) {
        const f = places.length;
        scores.set(id,
          (scores.get(id) ?? 0) + (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * this.#docs[id].length) / mean)));
      }
    }
    for (const id of [...scores.keys()]) {
      if (without.some(t => this.#terms.get(t)?.has(id)) ||
        !phrases.every(p => (this.#terms.get(p[0])?.get(id) ?? []).some(({ i }) => p.every((term,
        k) => this.#terms.get(term)?.get(id)?.some(x => x.i === i + k))))) scores.delete(id);
    }
    return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([id,
      score]) => ({ title: this.#docs[id].title, score, text: this.#highlight(id, [...words,
      ...phrases.flat()]) }));
  }
  #highlight(id, terms) {
    const {
      text
  } = this.#docs[id];
    const places = terms.flatMap(t => this.#terms.get(t)?.get(id) ?? []).sort((a,
      b) => a.at - b.at);
    let out = "", at = 0;
    for (const p of places) {
      if (p.at < at) continue;
      out += text.slice(at, p.at) + "<" + text.slice(p.at, p.end) + ">";
      at = p.end;
    }
    return (out + text.slice(at)).slice(0, 70);
  }
  get terms() {
    return this.#terms.size;
  }
}
