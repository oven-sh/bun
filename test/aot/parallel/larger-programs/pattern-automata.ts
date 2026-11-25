// Expressions compiled to automata: a parser, Thompson's construction, subsets, minimal machines, matching by sets of states, texts drawn from a machine
type Ast = {
  kind: "empty"
} | {
  kind: "set";
  ranges: readonly (readonly [number, number])[]
} | {
  kind: "seq";
  list: Ast[]
} | {
  kind: "alt";
  list: Ast[]
} | {
  kind: "repeat";
  of: Ast;
  min: number;
  max: number
} | {
  kind: "group";
  of: Ast;
  index: number
};
const ALL: readonly [number, number] = [0, 127];
class PatternError extends SyntaxError {
  constructor(message: string, readonly pattern: string, readonly at: number) {
    super(`${message} at ${at} of /${pattern}/`);
    this.name = "PatternError";
  }
}
class PatternParser {
  #i = 0;
  groups = 0;
  constructor(readonly text: string) {
  }
  static readonly classes: Record<string, (readonly [number, number])[]> = {
    d: [[48, 57]], w: [[48, 57], [65, 90], [95, 95], [97, 122]], s: [[9, 13], [32, 32]]
};
  static negate(ranges: readonly (readonly [number, number])[]): (readonly [number, number])[] {
    const out: [number, number][] = [];
    let from = 0;
    for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
      if (a > from) out.push([from, a - 1]);
      from = Math.max(from, b + 1);
    }
    if (from <= 127) out.push([from, 127]);
    return out;
  }
  #fail(message: string): never {
    throw new PatternError(message, this.text, this.#i);
  }
  parse(): Ast {
    const a = this.#alt();
    if (this.#i < this.text.length) this.#fail("unmatched )");
    return a;
  }
  #alt(): Ast {
    const list = [this.#seq()];
    while (this.text[this.#i] === "|") {
      this.#i++;
      list.push(this.#seq());
    }
    return list.length === 1 ? list[0] : {
      kind: "alt", list
  };
  }
  #seq(): Ast {
    const list: Ast[] = [];
    while (this.#i < this.text.length &&
      !"|)".includes(this.text[this.#i])) list.push(this.#repeat());
    return list.length === 0 ? {
      kind: "empty"
  } : list.length === 1 ? list[0] : {
      kind: "seq", list
  };
  }
  #repeat(): Ast {
    let of = this.#atom();
    for (;;) {
      const c = this.text[this.#i];
      let min: number, max: number;
      if (c === "*") [min, max] = [0, Infinity];
      else if (c === "+") [min, max] = [1, Infinity];
      else if (c === "?") [min, max] = [0, 1];
      else if (c === "{") {
        const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.text.slice(this.#i));
        if (!m) this.#fail("bad repeat");
        min = +m![1];
        max = m![2] ? (m![3] ? +m![3] : Infinity) : min;
        if (max < min) this.#fail("repeat out of order");
        this.#i += m![0].length - 1;
    } else return of;
      this.#i++;
      of = {
        kind: "repeat", of, min, max
    };
    }
  }
  #escape(): (readonly [number, number])[] {
    const c = this.text[this.#i++];
    if (c === undefined) this.#fail("escape at the end");
    const k = PatternParser.classes[c.toLowerCase()];
    if (k) return c === c.toLowerCase() ? k : PatternParser.negate(k);
    const code = ({ n: "\n", t: "\t" }[c] ?? c).charCodeAt(0);
    return [[code, code]];
  }
  #atom(): Ast {
    const c = this.text[this.#i++];
    switch (c) {
      case "(": {
        const plain = this.text.startsWith("?:", this.#i);
        if (plain) this.#i += 2;
        const index = plain ? 0 : ++this.groups;
        const of = this.#alt();
        if (this.text[this.#i++] !== ")") {
          this.#i--;
          this.#fail("open group");
        }
        return plain ? of : {
          kind: "group", of, index
      };
      }
      case "[": {
        const not = this.text[this.#i] === "^";
        if (not) this.#i++;
        const ranges: (readonly [number, number])[] = [];
        for (let first = true; first || this.text[this.#i] !== "]"; first = false) {
          const x = this.text[this.#i++];
          if (x === undefined) this.#fail("open set");
          if (x === "]" && first) {
            this.#i--;
            break;
          }
          if (x === "\\") {
            ranges.push(...this.#escape());
            continue;
          }
          const a = x.charCodeAt(0);
          if (this.text[this.#i] === "-" && this.text[this.#i + 1] !== "]" &&
            this.text[this.#i + 1] !== undefined) {
            const b = this.text.charCodeAt(this.#i + 1);
            this.#i += 2;
            if (b < a) this.#fail("range out of order");
            ranges.push([a, b]);
        } else ranges.push([a, a]);
        }
        this.#i++;
        return {
          kind: "set", ranges: not ? PatternParser.negate(ranges) : ranges
      };
      }
      case ".": return {
        kind: "set", ranges: PatternParser.negate([[10, 10]])
    };
      case "\\": return {
        kind: "set", ranges: this.#escape()
    };
      case "*": case "+": case "?": this.#i--;
      return this.#fail("nothing to repeat");
      default: {
        const code = c.charCodeAt(0);
        return {
          kind: "set", ranges: [[code, code]]
      };
      }
    }
  }
}
class NfaState {
  static #next = 0;
  readonly id = NfaState.#next++;
  readonly free: NfaState[] = [];
  readonly edges: {
    readonly from: number;
    readonly to: number;
    readonly state: NfaState
}[] = [];
  static reset() {
    NfaState.#next = 0;
  }
}
interface Fragment {
  start: NfaState;
  end: NfaState
}
class Nfa {
  readonly start: NfaState;
  readonly end: NfaState;
  readonly size: number;
  constructor(ast: Ast) {
    NfaState.reset();
    const f = this.#build(ast);
    this.start = f.start;
    this.end = f.end;
    this.size = new NfaState().id;
  }
  #build(a: Ast): Fragment {
    switch (a.kind) {
      case "empty": {
        const s = new NfaState(), e = new NfaState();
        s.free.push(e);
        return {
          start: s, end: e
      };
      }
      case "set": {
        const s = new NfaState(), e = new NfaState();
        for (const [from, to] of a.ranges) s.edges.push({ from, to, state: e });
        return {
          start: s, end: e
      };
      }
      case "group": return this.#build(a.of);
      case "seq": {
        const parts = a.list.map(x => this.#build(x));
        for (let i = 1; i < parts.length; i++) parts[i - 1].end.free.push(parts[i].start);
        return {
          start: parts[0].start, end: parts[parts.length - 1].end
      };
      }
      case "alt": {
        const s = new NfaState(), e = new NfaState();
        for (const x of a.list) {
          const f = this.#build(x);
          s.free.push(f.start);
          f.end.free.push(e);
        }
        return {
          start: s, end: e
      };
      }
      case "repeat": {
        const s = new NfaState(), e = new NfaState();
        let at = s;
        for (let i = 0; i < a.min; i++) {
          const f = this.#build(a.of);
          at.free.push(f.start);
          at = f.end;
        }
        if (a.max === Infinity) {
          const f = this.#build(a.of);
          at.free.push(f.start, e);
          f.end.free.push(f.start, e);
      } else {
          at.free.push(e);
          for (let i = a.min; i < a.max; i++) {
            const f = this.#build(a.of);
            at.free.push(f.start);
            f.end.free.push(e);
            at = f.end;
          }
        }
        return {
          start: s, end: e
      };
      }
    }
  }
  static closure(states: Iterable<NfaState>): NfaState[] {
    const seen = new Set<NfaState>(states), stack = [...seen];
    while (stack.length) for (const s of stack.pop()!.free) if (!seen.has(s)) {
      seen.add(s);
      stack.push(s);
    }
    return [...seen].sort((a, b) => a.id - b.id);
  }
  test(text: string): boolean {
    let now = Nfa.closure([this.start]);
    for (let i = 0; i < text.length && now.length; i++) {
      const c = text.charCodeAt(i), next = new Set<NfaState>();
      for (const s of now) for (const e of s.edges) if (c >= e.from &&
        c <= e.to) next.add(e.state);
      now = Nfa.closure(next);
    }
    return now.includes(this.end);
  }
}
class Dfa {
  private constructor(readonly table: Int16Array[], readonly accepting: Uint8Array,
    readonly classes: Uint8Array, readonly representatives: number[]) {
  }
  get size() {
    return this.table.length;
  }
  static from(nfa: Nfa, limit = 2000): Dfa {
    const starts = Nfa.closure([nfa.start]);
    const marks = new Set<number>([0, 128]);
    const visit = [...starts], seen = new Set(visit);
    while (visit.length) {
      const s = visit.pop()!;
      for (const e of s.edges) {
        marks.add(e.from);
        marks.add(e.to + 1);
        if (!seen.has(e.state)) {
          seen.add(e.state);
          visit.push(e.state);
        }
      }
      for (const f of s.free) if (!seen.has(f)) {
        seen.add(f);
        visit.push(f);
      }
    }
    const points = [...marks].filter(p => p <= 128).sort((a, b) => a - b);
    const classes = new Uint8Array(128), representatives: number[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      representatives.push(points[i]);
      classes.fill(i, points[i], points[i + 1]);
    }
    const key = (list: NfaState[]) => list.map(s => s.id).join();
    const ids = new Map<string, number>([[key(starts), 0]]);
    const sets: NfaState[][] = [starts];
    const table: Int16Array[] = [];
    for (let i = 0; i < sets.length; i++) {
      const row = new Int16Array(representatives.length).fill(-1);
      for (let k = 0; k < representatives.length; k++) {
        const c = representatives[k], next = new Set<NfaState>();
        for (const s of sets[i]) for (const e of s.edges) if (c >= e.from &&
          c <= e.to) next.add(e.state);
        if (!next.size) continue;
        const list = Nfa.closure(next), id = key(list);
        let to = ids.get(id);
        if (to === undefined) {
          to = sets.length;
          if (to >= limit) throw new RangeError("too many states");
          ids.set(id, to);
          sets.push(list);
        }
        row[k] = to;
      }
      table.push(row);
    }
    return new Dfa(table, Uint8Array.from(sets, s => (s.includes(nfa.end) ? 1 : 0)), classes,
      representatives);
  }
  minimal(): Dfa {
    const n = this.size, dead = n;
    let group = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) group[i] = this.accepting[i];
    group[dead] = 0;
    let count = 0;
    for (;;) {
      const keys = new Map<string, number>();
      const next = new Int32Array(n + 1);
      for (let i = 0; i <= n; i++) {
        let k = String(group[i]);
        for (let c = 0; c < this.representatives.length; c++) {
          const to = i === dead ? dead : this.table[i][c] < 0 ? dead : this.table[i][c];
          k += "," + group[to];
        }
        let id = keys.get(k);
        if (id === undefined) keys.set(k, (id = keys.size));
        next[i] = id;
      }
      if (keys.size === count) break;
      count = keys.size;
      group = next;
    }
    const deadGroup = group[dead];
    const order = new Map<number, number>();
    const queue = [0];
    const first: number[] = [];
    if (group[0] === deadGroup) return new Dfa([new Int16Array(this.representatives.length).fill(-1)],
      Uint8Array.of(0), this.classes, this.representatives);
    order.set(group[0], 0);
    first.push(0);
    while (queue.length) {
      const i = queue.shift()!;
      for (let c = 0; c < this.representatives.length; c++) {
        const to = this.table[i][c];
        if (to < 0 || group[to] === deadGroup || order.has(group[to])) continue;
        order.set(group[to], order.size);
        first.push(to);
        queue.push(to);
      }
    }
    return new Dfa(first.map(i => this.table[i].map(to => (to < 0 ||
      group[to] === deadGroup ? -1 : order.get(group[to])!))), Uint8Array.from(first,
      i => this.accepting[i]), this.classes, this.representatives);
  }
  test(text: string): boolean {
    let s = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 127) return false;
      s = this.table[s][this.classes[c]];
      if (s < 0) return false;
    }
    return this.accepting[s] === 1;
  }
  longest(text: string, from: number): number {
    let s = 0, best = this.accepting[0] ? from : -1;
    for (let i = from; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 127) break;
      s = this.table[s][this.classes[c]];
      if (s < 0) break;
      if (this.accepting[s]) best = i + 1;
    }
    return best;
  }
  *matches(text: string): Generator<[number, number]> {
    for (let i = 0; i <= text.length; ) {
      const end = this.longest(text, i);
      if (end > i) {
        yield [i, end];
        i = end;
    } else i++;
    }
  }
  samples(limit: number, length: number): string[] {
    const out: string[] = [];
    const walk = (s: number, text: string) => {
      if (out.length >= limit) return;
      if (this.accepting[s]) out.push(text);
      if (text.length === length) return;
      for (let c = 0; c < this.representatives.length; c++) {
        const to = this.table[s][c];
        if (to >= 0) walk(to, text + String.fromCharCode(Math.max(33,
          this.representatives[c])));
      }
  };
    walk(0, "");
    return out;
  }
  count(length: number): bigint {
    let now = new Map<number, bigint>([[0, 1n]]), total = this.accepting[0] ? 1n : 0n;
    const sizes = this.representatives.map((_,
      i) => BigInt(this.classes.filter(c => c === i).length));
    for (let l = 0; l < length; l++) {
      const next = new Map<number, bigint>();
      for (const [s, n] of now) for (let c = 0; c < sizes.length; c++) {
        const to = this.table[s][c];
        if (to >= 0) next.set(to, (next.get(to) ?? 0n) + n * sizes[c]);
      }
      now = next;
      for (const [s, n] of now) if (this.accepting[s]) total += n;
    }
    return total;
  }
}
class Scanner<K extends string> {
  readonly #rules: {
    kind: K;
    dfa: Dfa
}[];
  constructor(rules: Record<K, string>) {
    this.#rules = (Object.keys(rules) as K[]).map(kind => ({ kind,
      dfa: Dfa.from(new Nfa(new PatternParser(rules[kind]).parse())).minimal() }));
  }
  *scan(text: string): Generator<{
    kind: K | "error";
    text: string
  }
  > {
    for (let i = 0; i < text.length; ) {
      let best: {
        kind: K;
        end: number
    } | null = null;
      for (const { kind, dfa } of this.#rules) {
        const end = dfa.longest(text, i);
        if (end > i && (!best || end > best.end)) best = {
          kind, end
      };
      }
      if (!best) {
        yield {
          kind: "error", text: text[i]
      };
        i++;
        continue;
      }
      yield {
        kind: best.kind, text: text.slice(i, best.end)
    };
      i = best.end;
    }
  }
}
const patterns = ["a*b", "(a|b)*abb", "[a-c]{2,4}", "\\d+(\\.\\d+)?", "(foo|bar)+baz?",
  "x?y?z?", "([0-9a-f]{2}:){3}[0-9a-f]{2}", "(a?){5}a{5}", "[^\\w\\s]+",
  "\\w+@\\w+\\.(com|org)", "(ab|cd|ef)*(gh)?", "", "(a|aa|aaa)*b", ".*end"];
const texts = ["", "b", "aab", "abb", "babb", "abc", "abcd", "abcde", "3", "3.14", "3.",
  "foobarbaz", "barba", "xz", "yx", "0a:1b:2c:3d", "0a:1b:2c", "aaaaa", "aaaaaaaaaa", "!?#",
  "me@x.com", "me@x.net", "abcdgh", "the end", "end\nend"];
let differ = 0, tested = 0;
for (const p of patterns) {
  const nfa = new Nfa(new PatternParser(p).parse());
  const dfa = Dfa.from(nfa), small = dfa.minimal();
  const real = new RegExp(`^(?:${p})$`);
  const row = texts.map(t => {
    tested++;
    const a = nfa.test(t), b = dfa.test(t), c = small.test(t), d = real.test(t);
    if (a !== b || b !== c || (c !== d && !t.includes("\n"))) differ++;
    return c ? 1 : 0;
}).join("");
  console.log(p || "(empty)", nfa.size, dfa.size, small.size, row, small.samples(3,
    6).join(","), String(small.count(6)));
}
console.log("differ", differ, tested);
const scanner = new Scanner({ number: "\\d+(\\.\\d+)?", word: "[A-Za-z_]\\w*", space: "\\s+",
  string: '"[^"]*"', op: "(==|<=|>=|=>|[-+*/=<>();{}])" });
let counts: Record<string, number> = {
}, length = 0;
for (let i = 0; i < 500; i++) for (const t of scanner.scan(`let x${i} = (${i} + 2.5) * "text ${i}" ; if (a <= b${i % 7}) { f(x) ; } @ 1.2.3`)) {
  counts[t.kind] = (counts[t.kind] ?? 0) + 1;
  length += t.text.length;
}
console.log(JSON.stringify(counts), length);
const words = Dfa.from(new Nfa(new PatternParser("[a-z]+(ing|ed)").parse())).minimal();
const prose = "he was running and jumped singing while the red king fed " + "x".repeat(50);
let found = 0;
for (let i = 0; i < 2000; i++) for (const [a, b] of words.matches(prose)) found += b - a;
console.log(found, [...words.matches(prose)].map(([a, b]) => prose.slice(a, b)).join());
for (const bad of ["(", "a)", "*a", "[b-a]", "[a", "a{3,1}", "a{x}", "\\"]) try {
  new PatternParser(bad).parse();
  console.log("fine", bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
try {
  Dfa.from(new Nfa(new PatternParser("(a|b)*a(a|b){12}").parse()), 500);
} catch (e) {
  console.log((e as Error).message);
}
