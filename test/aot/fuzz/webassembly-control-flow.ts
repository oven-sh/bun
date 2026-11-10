// WebAssembly functions of few variables and small constants: the same values tested again, constant conditions, blocks with results, loops and switches
import type { Random } from "./random";
import { driver, encodings } from "./webassembly-modules";

let R: () => number;
const int = (n: number) => Math.floor(R() * n);
const pick = (items: readonly any[]): any => items[int(items.length)];
const chance = (p: number) => R() < p;

const I32 = 0x7f,
  I64 = 0x7e;
const uleb = v => {
  v = BigInt(v);
  const o: any[] = [];
  for (;;) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    o.push(b);
    if (!v) return o;
  }
};
const sleb = v => {
  v = BigInt(v);
  const o: any[] = [];
  for (;;) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && !(b & 0x40)) || (v === -1n && b & 0x40);
    if (!done) b |= 0x80;
    o.push(b);
    if (done) return o;
  }
};
const vec = items => [...uleb(items.length), ...items.flat()];
const section = (id, body) => [id, ...uleb(body.length), ...body];
const str = s => [...uleb(s.length), ...[...s].map(c => c.charCodeAt(0))];
const K = () => pick([0, 0, 0, 1, 1, 1, 2, 3, 4, 5, 7, -1, -1, 8, 255, 256, 0x7fffffff, -0x80000000]);
const c32 = v => [0x41, ...sleb(v)],
  c64 = v => [0x42, ...sleb(v)];
class Body {
  [name: string]: any;

  constructor(m: any, index: number) {
    this.m = m;
    this.index = index;
    this.params = m.sigs[index];
    this.locals = [...this.params];
    this.extra = [];
    for (let i = 2 + int(4); i-- > 0;) {
      const t = chance(0.75) ? I32 : I64;
      this.locals.push(t);
      this.extra.push(t);
    }
    this.out = [];
    this.labels = [];
    this.budget = 25 + int(70);
    this.kept = new Set();
    this.loops = 0;
    this.calls = 2;
  }
  e(...b: any[]): void {
    for (const x of b)
      if (Array.isArray(x)) this.out.push(...x);
      else this.out.push(x);
  }
  of(t, w = false) {
    const r: any[] = [];
    this.locals.forEach((x, i) => x === t && (!w || !this.kept.has(i)) && r.push(i));
    return r;
  }
  leaf(t) {
    const l = this.of(t);
    if (l.length && chance(0.62)) this.e(0x20, uleb(pick(l)));
    else if (chance(0.15)) this.e(0x23, uleb(t === I32 ? pick([0, 1]) : 2));
    else this.e(t === I32 ? c32(K()) : c64(K()));
  }
  expr(t, d) {
    if (d <= 0 || this.budget-- <= 0) return this.leaf(t);
    const r = int(100);
    if (r < 25) return this.leaf(t);
    if (r < 38) {
      this.cond(d - 1);
      this.e(0x04, t);
      this.labels.push(t);
      this.expr(t, d - 1);
      this.e(0x05);
      this.expr(t, d - 1);
      this.labels.pop();
      this.e(0x0b);
      return;
    }
    if (r < 50) {
      this.e(0x02, t);
      this.labels.push(t);
      this.expr(t, d - 1);
      this.cond(d - 1);
      this.e(0x0d, 0);
      if (chance(0.3)) {
        this.e(0x21, uleb(this.temp(t)));
        if (chance(0.5)) this.stmt(d - 1);
      } else {
        this.e(0x1a);
        if (chance(0.5)) this.stmt(d - 1);
      }
      if (chance(0.3)) {
        this.expr(t, d - 1);
        this.cond(d - 1);
        this.e(0x0d, 0, 0x1a);
      }
      this.expr(t, d - 1);
      this.labels.pop();
      this.e(0x0b);
      return;
    }
    if (r < 58) {
      this.expr(t, d - 1);
      this.expr(t, d - 1);
      this.cond(d - 1);
      this.e(0x1b);
      return;
    }
    if (r < 64) {
      const l = this.of(t, true);
      if (l.length) {
        this.expr(t, d - 1);
        this.e(0x22, uleb(pick(l)));
        return;
      }
    }
    if (r < 68 && t === I32) return this.cond(d);
    if (r < 72) {
      if (t === I32) {
        this.expr(I64, d - 1);
        this.e(0xa7);
      } else {
        this.expr(I32, d - 1);
        this.e(pick([0xac, 0xad]));
      }
      return;
    }
    if (r < 75 && this.calls > 0 && this.index + 1 < this.m.n) {
      this.calls--;
      return this.call(t, d);
    }
    if (r < 78 && t === I32) {
      this.leaf(I32);
      this.e(c32(0x3fc), 0x71, 0x28, 0, 0);
      return;
    }
    this.expr(t, d - 1);
    if (chance(0.6)) this.e(t === I32 ? c32(K()) : c64(K()));
    else this.expr(t, d - 1);
    this.e(
      t === I32
        ? pick([0x6a, 0x6b, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x6c])
        : pick([0x7c, 0x7d, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88]),
    );
  }
  temp(t) {
    const i = this.locals.length;
    this.locals.push(t);
    this.extra.push(t);
    return i;
  }
  cond(d) {
    const r = int(100),
      l = this.of(I32);
    if (r < 22) this.e(0x20, uleb(pick(l)));
    else if (r < 34) this.e(0x20, uleb(pick(l)), 0x45);
    else if (r < 55) {
      this.e(0x20, uleb(pick(l)), c32(K()), 0x46 + int(10));
      if (chance(0.2)) this.e(0x45);
    } else if (r < 62) {
      this.e(0x20, uleb(pick(l)), 0x20, uleb(pick(l)), 0x46 + int(10));
    } else if (r < 68) {
      this.leaf(I64);
      this.e(c64(K()), 0x51 + int(10));
    } else if (r < 72) {
      this.leaf(I64);
      this.e(0x50);
    } else if (r < 80) {
      if (chance(0.5)) this.e(c32(K()));
      else this.e(c64(K()), 0x50);
    } else if (r < 85) {
      this.e(0x20, uleb(pick(l)), c32(pick([1, 2, 4, 6, 255])), 0x71);
      if (chance(0.4)) this.e(0x45);
    } else if (r < 90) {
      this.cond(d - 1);
      this.cond(d - 1);
      this.e(pick([0x71, 0x72, 0x73]));
    } else this.expr(I32, Math.min(d, 2));
  }
  call(t, d) {
    const c: any[] = [];
    for (let i = this.index + 1; i < this.m.n; i++) if (this.m.results[i] === t) c.push(i);
    if (!c.length) return this.leaf(t);
    const f = pick(c);
    for (const p of this.m.sigs[f]) {
      if (chance(0.5)) this.leaf(p);
      else this.expr(p, d - 2);
    }
    this.e(0x10, uleb(f + 1));
  }
  set(d) {
    const l = this.of(pick([I32, I32, I64]), true);
    if (!l.length) return this.e(1);
    const i = pick(l);
    if (chance(0.35)) this.e(this.locals[i] === I32 ? c32(K()) : c64(K()));
    else this.expr(this.locals[i], d - 1);
    this.e(0x21, uleb(i));
  }
  stmts(d, n) {
    for (let i = 0; i < n; i++) this.stmt(d);
  }
  stmt(d) {
    if (d <= 0 || this.budget-- <= 0) return this.set(1);
    const r = int(100);
    if (r < 30) this.set(d);
    else if (r < 48) {
      this.cond(d);
      this.e(0x04, 0x40);
      this.labels.push(0);
      this.stmts(d - 1, 1 + int(2));
      if (chance(0.45)) {
        this.e(0x05);
        this.stmts(d - 1, 1 + int(2));
      }
      this.labels.pop();
      this.e(0x0b);
    } else if (r < 58) {
      this.e(0x02, 0x40);
      this.labels.push(0);
      this.stmts(d - 1, 1 + int(2));
      this.cond(d);
      this.e(0x0d, 0);
      this.stmts(d - 1, 1 + int(2));
      this.labels.pop();
      this.e(0x0b);
    } else if (r < 63) {
      this.leaf(I32);
      this.e(c32(0x3fc), 0x71);
      this.expr(I32, d - 1);
      this.e(0x36, 0, 0);
    } else if (r < 67) this.e(0x10, 0);
    else if (r < 70) {
      this.expr(I32, d - 1);
      this.e(0x24, 1);
    } else if (r < 73) {
      this.cond(d);
      this.e(0x04, 0x40);
      this.expr(this.m.results[this.index], 1);
      this.e(0x0f, 0x0b);
    } else if (r < 80 && this.loops < 2) {
      const c = this.temp(I32);
      this.kept.add(c);
      this.loops++;
      this.e(c32(1 + int(5)), 0x21, uleb(c), 0x02, 0x40);
      this.labels.push(0);
      this.e(0x03, 0x40);
      this.labels.push(-1);
      this.e(0x20, uleb(c), 0x45, 0x0d, 1, 0x20, uleb(c), 0x41, 1, 0x6b, 0x21, uleb(c));
      this.stmts(d - 1, 1 + int(3));
      if (chance(0.4)) {
        this.cond(d);
        this.e(0x0d, uleb(int(2)));
        this.stmts(d - 1, 1);
      }
      this.e(0x0c, 0);
      this.labels.pop();
      this.e(0x0b);
      this.labels.pop();
      this.e(0x0b);
      this.loops--;
    } else if (r < 86) {
      const n = 1 + int(4);
      for (let i = 0; i <= n; i++) {
        this.e(0x02, 0x40);
        this.labels.push(0);
      }
      if (chance(0.7)) this.e(0x20, uleb(pick(this.of(I32))));
      else this.expr(I32, 1);
      this.e(0x0e, vec(Array.from({ length: n }, () => uleb(int(n + 1)))), uleb(int(n + 1)));
      for (let i = 0; i <= n; i++) {
        this.labels.pop();
        this.e(0x0b);
        if (i < n) {
          this.stmts(d - 1, 1);
          if (chance(0.6)) this.e(0x0c, uleb(n - 1 - i));
        }
      }
    } else if (r < 91) {
      const v = this.labels.map((x, i) => (x === 0 ? i : -1)).filter(i => i >= 0);
      if (v.length) {
        this.cond(d);
        this.e(0x0d, uleb(this.labels.length - 1 - pick(v)));
      } else this.set(d);
    } else if (r < 94) {
      this.expr(pick([I32, I64]), d);
      this.e(0x1a);
    } else this.set(d);
  }
  generate() {
    this.stmts(4, 3 + int(5));
    if (chance(0.5)) {
      const n = this.locals.length;
      for (let i = 0; i < n && i < 24; i++)
        this.e(
          c32(0x400 + this.index * 256 + i * 8),
          0x20,
          uleb(i),
          this.locals[i] === I32 ? [0x36, 0, 0] : [0x37, 0, 0],
        );
    }
    this.budget += 8;
    this.expr(this.m.results[this.index], 3);
    this.e(0x0b);
    return [...vec(this.extra.map(t => [1, t])), ...this.out];
  }
}
function randomModule() {
  const n = 10 + int(8);
  const m: any = { n, sigs: [], results: [] };
  for (let i = 0; i < n; i++) {
    m.sigs.push(Array.from({ length: 1 + int(3) }, () => pick([I32, I32, I64])));
    if (!m.sigs[i].includes(I32)) m.sigs[i][0] = I32;
    m.results.push(chance(0.8) ? I32 : I64);
  }
  const types: any[] = [[[], []]],
    ti = (p, r) => {
      const k = p + "|" + r;
      let x = types.findIndex(t => t[0] + "|" + t[1] === k);
      if (x < 0) {
        x = types.length;
        types.push([p, r]);
      }
      return x;
    };
  const bodies = m.sigs.map((s, i) => new Body(m, i).generate());
  const ft = m.sigs.map((s, i) => ti(s, [m.results[i]]));
  const globals = [
    [I32, 1024],
    [I32, 3],
    [I64, 5],
  ];
  const extra: any[] = [];
  globals.forEach(([t], i) => {
    extra.push(["get" + i, ti([], [t]), [0, 0x23, i, 0x0b]], ["set" + i, ti([t], []), [0, 0x20, 0, 0x24, i, 0x0b]]);
  });
  const out = [
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, vec(types.map(([p, r]) => [0x60, ...vec(p.map(x => [x])), ...vec(r.map(x => [x]))]))),
    ...section(2, vec([[...str("env"), ...str("h3"), 0, 0]])),
    ...section(3, vec([...ft, ...extra.map(e => e[1])].map(uleb))),
    ...section(4, vec([[0x70, 0, ...uleb(8)]])),
    ...section(5, vec([[1, 1, 1]])),
    ...section(6, vec(globals.map(([t, v]) => [t, 1, ...(t === I32 ? c32(v) : c64(v)), 0x0b]))),
    ...section(
      7,
      vec([
        ...m.sigs.map((_, i) => [...str("f" + i), 0, ...uleb(i + 1)]),
        ...extra.map((e, i) => [...str(e[0]), 0, ...uleb(n + 1 + i)]),
        [...str("memory"), 2, 0],
        [...str("table"), 1, 0],
      ]),
    ),
    ...section(10, vec([...bodies, ...extra.map(e => e[2])].map(b => [...uleb(b.length), ...b]))),
  ];
  return {
    bytes: new Uint8Array(out),
    info: {
      funcs: m.sigs.map((s, i) => [s, [m.results[i]]]),
      globals: globals.map(([t]) => [t, 1]),
      fuel: 0,
      memory: null,
      imports: ["h3"],
    },
  };
}

export function generate(random: Random): string {
  R = () => random.next() / 4294967296;
  const text = [driver];
  for (let k = 0, n = random.between(1, 3); k < n; k++) {
    for (let tries = 0; tries < 20; tries++) {
      const { bytes, info } = randomModule();
      if (!WebAssembly.validate(bytes)) continue;
      text.push(`run(${k}, new WebAssembly.Module(${random.pick(encodings)(bytes)}), ${JSON.stringify(info)});`);
      break;
    }
  }
  return text.join("\n");
}
