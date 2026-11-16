// lib_* features: JavaScript shaped like the libraries a CLI bundles — a line
// diff, semver ordering, argv and shell-word parsing, a schema validator, an
// LRU, flex layout, an event emitter, JSON and regex helpers, promise plumbing,
// error paths — each driven long enough that JavaScriptCore compiles it in every
// tier. lib_jit_* are single shapes aimed at one JIT or runtime path each
// (species-aware map/filter, RegExp legacy statics, object identity on untyped
// operands, code compiled at run time from UTF-16 source, …).
let sink = 0;
const ROUNDS = () => 400;
function rounds(fn) {
  const n = ROUNDS();
  for (let r = 0; r < n; r++) fn(r);
}
// -- diff: Myers O(ND) over lines + unified hunks --
function diffLines(a, b) {
  const n = a.length,
    m = b.length,
    max = n + m,
    v = new Int32Array(2 * max + 2),
    trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]) ? v[k + 1 + max] : v[k - 1 + max] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, max);
    }
  }
  return [];
}
function backtrack(trace, a, b, max) {
  let x = a.length,
    y = b.length;
  const ops = [];
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d],
      k = x - y;
    const prevK = k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]) ? k + 1 : k - 1;
    const px = v[prevK + max],
      py = px - prevK;
    while (x > px && y > py) {
      ops.unshift({ t: " ", s: a[--x] });
      y--;
    }
    if (d > 0) ops.unshift(x === px ? { t: "+", s: b[--y] } : { t: "-", s: a[--x] });
  }
  return ops;
}
function unified(ops, ctx = 3) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === " ") {
      i++;
      continue;
    }
    const start = Math.max(0, i - ctx);
    let end = i;
    while (end < ops.length && (ops[end].t !== " " || ops.slice(end, end + ctx * 2).some(o => o.t !== " "))) end++;
    end = Math.min(ops.length, end + ctx);
    out.push(
      `@@ -${start + 1},${end - start} +${start + 1},${end - start} @@`,
      ...ops.slice(start, end).map(o => o.t + o.s),
    );
    i = end;
  }
  return out.join("\n");
}
// -- semver --
const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
function parseSemver(s) {
  const m = SEMVER.exec(s);
  if (m == null) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [], build: m[5] };
}
function cmpSemver(a, b) {
  const x = parseSemver(a),
    y = parseSemver(b);
  if (!x || !y) return String(a).localeCompare(String(b));
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  if (!x.pre.length != !y.pre.length) return x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i],
      q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p),
      qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p - +q;
    } else if (pn != qn) return pn ? -1 : 1;
    else if (p != q) return p < q ? -1 : 1;
  }
  return 0;
}
function satisfies(v, range) {
  return range.split("||").some(part =>
    part
      .trim()
      .split(/\s+/)
      .every(c => {
        const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(c);
        const op = m[1] || "=",
          ver = m[2];
        const r = cmpSemver(v, ver);
        switch (op) {
          case "^":
            return r >= 0 && parseSemver(v)?.major === parseSemver(ver)?.major;
          case "~":
            return r >= 0 && parseSemver(v)?.minor === parseSemver(ver)?.minor;
          case ">=":
            return r >= 0;
          case "<=":
            return r <= 0;
          case ">":
            return r > 0;
          case "<":
            return r < 0;
          default:
            return r === 0;
        }
      }),
  );
}
// -- argv + shell parsing --
function shellSplit(s) {
  const out = [];
  let cur = "",
    q = null,
    esc = false,
    any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i],
      code = s.charCodeAt(i);
    if (esc) {
      cur += c;
      esc = false;
      continue;
    }
    switch (c) {
      case "\\":
        if (q !== "'") {
          esc = true;
          continue;
        }
        break;
      case "'":
      case '"':
        if (q == null) {
          q = c;
          any = true;
          continue;
        }
        if (q == c) {
          q = null;
          continue;
        }
        break;
      case " ":
      case "\t":
      case "\n":
        if (q == null) {
          if (cur || any) out.push(cur);
          cur = "";
          any = false;
          continue;
        }
        break;
      case "|":
      case "&":
      case ";":
      case ">":
      case "<":
        if (q == null) {
          if (cur) out.push(cur);
          cur = "";
          out.push({ op: s.substr(i, s[i + 1] === c ? 2 : 1) });
          if (s[i + 1] === c) i++;
          continue;
        }
        break;
      case "$":
        if (q !== "'" && s[i + 1] === "{") {
          const end = s.indexOf("}", i);
          cur += process.env[s.substring(i + 2, end)] ?? "";
          i = end;
          continue;
        }
        break;
    }
    if (code < 32 && code !== 9) continue;
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
function parseArgv(argv, spec) {
  const opts = Object.create(null),
    pos = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a == "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      let v;
      const eq = a.indexOf("=");
      if (eq != -1) {
        v = a.substr(eq + 1);
        a = a.substr(0, eq);
      }
      let name = a.slice(2);
      let neg = false;
      if (name.startsWith("no-")) {
        neg = true;
        name = name.slice(3);
      }
      const key = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()),
        t = spec[key];
      if (t === undefined) {
        opts[key] = v ?? true;
        continue;
      }
      if (typeof t === "boolean" || t === Boolean) opts[key] = !neg;
      else if (t === Number) opts[key] = Number(v ?? argv[++i]);
      else if (Array.isArray(t)) (opts[key] ??= []).push(v ?? argv[++i]);
      else opts[key] = v ?? argv[++i];
    } else if (a[0] == "-" && a.length > 1) {
      for (const ch of a.slice(1)) opts[ch] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}
// -- schema validation (zod-like) --
class Issue extends Error {
  constructor(path, msg) {
    super(msg);
    this.path = path;
  }
}
class Schema {
  #checks = [];
  #optional = false;
  constructor(kind) {
    Object.defineProperty(this, "kind", { value: kind, enumerable: true, configurable: true });
  }
  get isOptional() {
    return this.#optional;
  }
  optional() {
    const s = new this.constructor(this.el ?? this.shape ?? this.opts);
    s.#checks = this.#checks.slice();
    s.#optional = true;
    return s;
  }
  refine(fn, msg) {
    this.#checks.push({ fn, msg });
    return this;
  }
  static isSchema(x) {
    return x != null && typeof x === "object" && #checks in x;
  }
  parse(v, path = []) {
    if (v === undefined && this.#optional) return v;
    const out = this._parse(v, path);
    for (const c of this.#checks) if (!c.fn.call(this, out)) throw new Issue(path, c.msg);
    return out;
  }
  safeParse(v) {
    try {
      return { success: true, data: this.parse(v) };
    } catch (e) {
      return { success: false, error: e };
    }
  }
}
class StringSchema extends Schema {
  constructor() {
    super("string");
  }
  _parse(v, p) {
    if (typeof v !== "string") throw new Issue(p, `Expected string, received ${typeof v}`);
    return v;
  }
  min(n) {
    return this.refine(s => s.length >= n, `min ${n}`);
  }
}
class NumberSchema extends Schema {
  constructor() {
    super("number");
  }
  _parse(v, p) {
    if (typeof v !== "number" || Number.isNaN(v)) throw new Issue(p, "Expected number");
    return v;
  }
  int() {
    return this.refine(Number.isInteger, "int");
  }
}
class BoolSchema extends Schema {
  constructor() {
    super("boolean");
  }
  _parse(v, p) {
    if (typeof v != "boolean") throw new Issue(p, "Expected boolean");
    return v;
  }
}
class ArraySchema extends Schema {
  constructor(el) {
    super("array");
    this.el = el;
  }
  _parse(v, p) {
    if (!Array.isArray(v)) throw new Issue(p, "Expected array");
    return v.map((x, i) => this.el.parse(x, [...p, i]));
  }
}
class ObjectSchema extends Schema {
  constructor(shape) {
    super("object");
    this.shape = shape;
  }
  _parse(v, p) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Issue(p, "Expected object");
    const out = {};
    for (const k in this.shape) {
      const r = this.shape[k].parse(v[k], p.concat(k));
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  extend(more) {
    return new ObjectSchema({ ...this.shape, ...more });
  }
}
class UnionSchema extends Schema {
  constructor(opts) {
    super("union");
    this.opts = opts;
  }
  _parse(v, p) {
    for (const o of this.opts) {
      const r = o.safeParse(v);
      if (r.success) return r.data;
    }
    throw new Issue(p, "No union member matched");
  }
}
const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BoolSchema(),
  array: e => new ArraySchema(e),
  object: s => new ObjectSchema(s),
  union: o => new UnionSchema(o),
};
// -- LRU --
class LRU {
  constructor(max) {
    this.max = max;
    this.map = new Map();
    this.hits = 0;
  }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
      this.hits++;
    }
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, v);
    return this;
  }
  *entries() {
    yield* this.map;
  }
}
// -- flex layout --
function layout(node, w, h) {
  const dir = node.dir ?? "column",
    pad = node.pad | 0,
    gap = node.gap | 0,
    kids = node.kids ?? [];
  const main = dir === "row" ? w : h,
    avail = Math.max(0, main - pad * 2 - gap * Math.max(0, kids.length - 1));
  let fixed = 0,
    grow = 0;
  for (const k of kids) {
    if (k.grow) grow += k.grow;
    else fixed += (dir === "row" ? k.w : k.h) ?? 1;
  }
  const free = Math.max(0, avail - fixed);
  let pos = pad;
  for (const k of kids) {
    const size = k.grow ? Math.floor((free * k.grow) / grow) : ((dir === "row" ? k.w : k.h) ?? 1);
    k.x = dir === "row" ? pos : pad;
    k.y = dir === "row" ? pad : pos;
    k.cw = dir === "row" ? size : Math.max(0, w - pad * 2);
    k.ch = dir === "row" ? Math.max(0, h - pad * 2) : size;
    pos += size + gap;
    if (k.kids) layout(k, k.cw, k.ch);
    k.flags = k.flags | 0 | ((size > 0 ? 1 : 0) << 1) | ((k.grow ? 1 : 0) << 2);
    k.hash = ((k.x * 73856093) ^ (k.y * 19349663) ^ (size << 3)) >>> 0;
  }
  return node;
}
// -- terminal string width --
// -- emitter --
class Emitter {
  constructor() {
    this._events = Object.create(null);
    this._count = 0;
  }
  on(t, fn) {
    (this._events[t] ||= []).push(fn);
    this._count++;
    return this;
  }
  off(t, fn) {
    const l = this._events[t];
    if (!l) return this;
    const i = l.indexOf(fn);
    if (i !== -1) {
      l.splice(i, 1);
      this._count--;
    }
    if (l.length === 0) delete this._events[t];
    return this;
  }
  once(t, fn) {
    const self = this;
    function w() {
      self.off(t, w);
      return fn.apply(this, arguments);
    }
    w.listener = fn;
    return this.on(t, w);
  }
  emit(t) {
    const l = this._events[t];
    if (l === undefined) return false;
    const args = Array.prototype.slice.call(arguments, 1);
    for (const fn of l.slice()) {
      if (args.length === 0) fn.call(this);
      else if (args.length === 1) fn.call(this, args[0]);
      else fn.apply(this, args);
    }
    return true;
  }
}
export const features = {
  async lib_diff() {
    const base = Array.from({ length: 120 }, (_, i) => `line ${i}: ${"const x = " + ((i * 7) % 13)};`);
    rounds(r => {
      const b = base.slice();
      b.splice(r % 50, 3, "inserted " + r, "another");
      b[(r * 7) % 100] += " // changed";
      if (r & 1) b.push("tail");
      const ops = diffLines(base, b);
      sink += unified(ops).length + ops.filter(o => o.t !== " ").length;
    });
  },
  async lib_semver() {
    const vs = [
      "1.2.3",
      "1.2.3-beta.1",
      "1.2.3-beta.10",
      "1.2.3-alpha",
      "2.0.0",
      "v1.10.0",
      "0.9.12+build.5",
      "1.2.3-rc.1",
      "10.0.0-0",
      "3.1.4",
    ];
    rounds(r => {
      const list = vs.concat(vs.map(v => v.replace(/\d+/, d => String(+d + (r % 3)))));
      list.sort(cmpSemver);
      sink +=
        list.indexOf("2.0.0") +
        list.filter(v => satisfies(v, "^1.2.0 || >=3.0.0 <11.0.0")).length +
        (list.includes("x") ? 1 : 0);
    });
  },
  async lib_shell() {
    const cmds = [
      `git commit -m "fix: handle 'quotes' & stuff" --no-verify`,
      `ls -la src/ | grep -E '\\.ts$' > out.txt; echo \${HOME} done`,
      `rg --json -n "foo\\sbar" --glob '!node_modules' -- src`,
      `bun test --timeout=5000 --bail a.test.ts && echo ok || echo fail`,
    ];
    const spec = { timeout: Number, bail: Boolean, glob: [String], json: true, verify: true };
    rounds(r => {
      for (const c of cmds) {
        const toks = shellSplit(c + " " + r);
        const words = toks.filter(t => typeof t == "string");
        const { opts, pos } = parseArgv(words.slice(1), spec);
        sink += toks.length + pos.length + Object.keys(opts).length + (opts.timeout | 0);
      }
    });
  },
  async lib_schema() {
    const Msg = z.object({
      role: z.union([z.string().min(1), z.number()]),
      content: z.array(z.object({ type: z.string(), text: z.string().optional(), n: z.number().int().optional() })),
      meta: z.object({ id: z.string(), ok: z.boolean() }).optional(),
    });
    const Ext = Msg.extend({ extra: z.number().optional() });
    rounds(() => {
      for (let i = 0; i < 60; i++) {
        const v = {
          role: i % 7 ? "user" : 3,
          content: [
            { type: "text", text: "hi " + i },
            { type: "image", n: i },
          ],
          meta: i % 3 ? { id: "m" + i, ok: true } : undefined,
          extra: i % 5 ? undefined : i,
        };
        const res = (i % 2 ? Msg : Ext).safeParse(i % 11 === 10 ? { ...v, content: "bad" } : v);
        sink += res.success ? res.data.content.length : res.error.path.length;
      }
      sink += Schema.isSchema(Msg) + Schema.isSchema({}) + Msg.shape.meta.isOptional;
    });
  },
  async lib_lru() {
    const c = new LRU(256);
    rounds(r => {
      for (let i = 0; i < 3000; i++) {
        const k = "k" + ((i * 2654435761 + r) % 512);
        const v = c.get(k);
        if (v == null) c.set(k, { i, r });
        else if (v.i != i) v.i = i;
      }
      sink += c.hits + [...c.entries()].length;
    });
  },
  async lib_layout() {
    const tree = () => ({
      dir: "column",
      pad: 1,
      gap: 0,
      kids: [
        { h: 1 },
        { grow: 1, dir: "row", gap: 1, kids: [{ w: 20 }, { grow: 2, kids: [{ h: 2 }, { grow: 1 }] }, { grow: 1 }] },
        { h: 3, dir: "row", kids: [{ grow: 1 }, { w: 10 }] },
      ],
    });
    rounds(r => {
      for (let i = 0; i < 300; i++) {
        const t = layout(tree(), 60 + ((i + r) % 80), 20 + (i % 30));
        sink +=
          t.kids[1].kids[1].cw +
          t.kids[2].y +
          (t.kids[1].kids[1].hash & 7) +
          Math.abs(-i) +
          Math.round(i / 3) +
          Math.ceil(i / 7) +
          ((i << 2) >> 1) +
          (-i >>> 28) +
          Number((BigInt(i) << 3n) & 255n) +
          Number(BigInt(i) ^ 5n) +
          Number(~BigInt(i) & 7n);
      }
    });
  },
  async lib_emitter() {
    const e = new Emitter();
    rounds(() => {
      const fns = [];
      for (let i = 0; i < 20; i++) {
        const f = function (a, b, c) {
          sink += (a | 0) + (b | 0) + (c | 0) + arguments.length;
        };
        fns.push(f);
        e.on("ev" + (i % 4), f);
      }
      e.once("ev0", x => (sink += x));
      for (let i = 0; i < 400; i++) {
        e.emit("ev" + (i % 4), i);
        e.emit("ev1", i, 2);
        e.emit("ev2", i, 2, 3);
        e.emit("ev3");
      }
      fns.forEach((f, i) => e.off("ev" + (i % 4), f));
      sink += e._count;
    });
  },
};
// -- more library shapes: JSON/regex helpers, promise plumbing, error paths, object-model corners, proxies, regex corpus,
//    runtime-compiled UTF-16 code, a very large function (wide operands), BigInt64 arrays, module namespace objects --
const REGEXES = [
  /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*)@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
  /\b(?:https?|ftp):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|]/gi,
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm,
  /^(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]/gm,
  /(?<![\w$])(?:const|let|var)\s+(?<name>[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*)\s*=/gu,
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\uFE0F|\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}])*/gu,
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Thai}|\p{Script=Devanagari}/gu,
  /[\p{L}\p{M}\p{N}\p{Pc}\p{Join_Control}]+/gu,
  /[\p{P}\p{S}]/gu,
  /[\p{Z}\p{Cc}\p{Cf}]/gu,
  /\p{Lu}\p{Ll}+/gu,
  /[\p{Alphabetic}&&\p{ASCII}]/v,
  /\p{White_Space}+/u,
  /\p{Regional_Indicator}{2}/u,
  /\p{Nd}+(?:[.,]\p{Nd}+)?/u,
  /[\p{Sc}\p{Sm}\p{Sk}\p{So}]/u,
  /\p{Default_Ignorable_Code_Point}/u,
  /\p{Mn}+/u,
  /\p{Lo}+/u,
  /\p{Lt}|\p{Lm}/u,
  /\p{Co}|\p{Cn}|\p{Cs}/u,
  /\p{Any}/u,
  /\p{Assigned}/u,
  /\w+/iu,
  /\b\w+\b/iu,
  /[^\W\d_]+/iu,
  /straße|ǅ|ﬀ/iu,
  /(?:error|warning|info|debug|trace|fatal|notice|critical|alert|emergency)(?=:)/i,
  /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s/,
  /^(?:true|false|null|undefined|NaN|Infinity)$/,
  /(?:^|\n)(#{1,6})[ \t]+(.+?)[ \t]*#*(?=\n|$)/g,
  /^ {0,3}(`{3,}|~{3,})([^`~\n]*)\n(?:|([\s\S]*?)\n)(?: {0,3}\1[~`]* *(?=\n|$)|$)/gm,
  /!?\[((?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?)\]\(\s*(<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*)(?:\s+("(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)))?\s*\)/g,
  /\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)|__(?=\S)([\s\S]*?\S)__(?!_)/g,
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g,
  /^( {0,3}(?:[*+-]|\d{1,9}[.)]))( [^\n]+?)?(?:\n|$)/gm,
  /\|(?:[^|\n]*\|)+\n\|(?:\s*:?-+:?\s*\|)+/g,
  /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<h>\d{2}):(?<m>\d{2})(?::(?<s>\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/,
  /^(?:\/|[A-Za-z]:\\)(?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]*$/,
  /\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml|lock)$/i,
  /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
  /(?:\r\n|\r|\n)/g,
  /[\u0000-\u001f\u007f-\u009f]/g,
  /[\uD800-\uDBFF][\uDC00-\uDFFF]/g,
  /[^\x20-\x7E]/g,
];
const REGEX_TEXT =
  "# Title\n\n```js\nexport async function fooBar(a) {\n  const ünïcödé = 1;\n}\n```\nimport { x } from './y.js'\nSee [link](https://example.com/a?b=c) and **bold** `code`, mail a.b@ex.org at 2024-02-29T12:34:56Z\n- item\n| a | b |\n|---|---|\nerror: 日本語 한국어 Привет Γειά مرحبا שלום สวัสดี नमस्ते 🇯🇵 👩‍💻 ✓ C:\\x\\y.ts $HOME ${PATH}\r\n\x1b[0m\u200b".repeat(
    4,
  );
const PROXY_TARGET = Object.freeze({ fixed: 1 });
features.lib_json = async function () {
  const esc = JSON.stringify({
    s: 'line\n"quoted"\ttab \\ back é ✓ \u2028',
    list: Array.from({ length: 50 }, (_, i) => ({ k: "key\n" + i, v: i * 1000003 })),
  });
  const esc16 = JSON.stringify({ t: '日本語\n"x"', n: [1, -2, 300000, 4e6], nested: { a: "\u00e9\u0001" } });
  rounds(r => {
    sink +=
      JSON.parse(esc).list.length +
      JSON.parse(esc16).n.length +
      JSON.stringify({ u: "ü✓" + r, i: r, arr: [r, r * 2, -r] }).length;
    sink +=
      "2024-02-29".replace(/(\d+)-(\d+)-(\d+)/, "$3/$2/$1").length +
      "John Smith".replace(/(?<first>\w+)\s(?<last>\w+)/, "$<last>, $<first> $$ $& $` $'").length;
    const csv = "a,b;c|d e,f;g|h i,j;k|l m,n;o|p q".repeat(3);
    sink += csv.split(/[,;| ]/).length + csv.split(/[,;| ]/).length + "a1b2c3".split(/\d/).length;
    sink +=
      "one two three four five".substr(4, 3).length +
      "path/to/some/file.test.ts".lastIndexOf("/fi") +
      "abc".substr(-2).length +
      "x.y.z.js".lastIndexOf(".js");
  });
};
features.lib_promise = async function () {
  const thenable = v => ({
    then(res) {
      res(v);
    },
  });
  async function inner(i) {
    await null;
    if (i % 97 === 0) throw new Error("inner " + i);
    return i;
  }
  async function outer(i) {
    try {
      return await inner(i);
    } catch (e) {
      return e.stack.length;
    }
  }
  for (let r = 0; r < ROUNDS() / 4; r++) {
    const ps = [];
    for (let i = 0; i < 200; i++)
      ps.push(
        new Promise(res => {
          if (i % 3 === 0) res(thenable(i));
          else if (i % 3 === 1) res(i);
          else queueMicrotask(() => res(Promise.resolve(i)));
        }),
      );
    sink +=
      (await Promise.all(ps)).length + (await Promise.all(Array.from({ length: 100 }, (_, i) => outer(i)))).length;
    const p = Promise.resolve(r);
    sink += await p
      .then(x => x + 1)
      .then(x => x * 2)
      .finally(() => {});
  }
};
features.lib_errors = async function () {
  function thrower(i) {
    if (i === -1) throw new TypeError("bad " + i);
    return i + 1;
  }
  function hot(i) {
    return thrower(i) * 2;
  }
  const bound = hot.bind(null);
  const bound2 = function (a, b, c) {
    return a + b + c;
  }.bind({}, 1);
  rounds(() => {
    let acc = 0;
    for (let i = 0; i < 2000; i++) acc += bound(i) + bound2(i, 2) + bound2.length + bound.name.length;
    try {
      hot(-1);
    } catch (e) {
      acc += e.stack.split("\n").length;
    }
    for (const f of [
      () => new Array(-1),
      () => "x".repeat(-1),
      () => (1).toFixed(500),
      () => null.x,
      () => undefined.call(),
      () =>
        new class {
          #p;
          static g(o) {
            return o.#p;
          }
        }.g({}),
      () => BigInt(1.5),
      () => Symbol() + "",
      () => {
        "use strict";
        return (function () {
          return arguments.callee;
        })();
      },
      () => Object.defineProperty(Object.freeze({}), "x", { value: 1 }),
      () =>
        new Proxy(PROXY_TARGET, {
          get() {
            return 2;
          },
        }).fixed,
      () => structuredClone(() => {}),
      () => decodeURIComponent("%"),
      () => new Intl.NumberFormat("en", { style: "currency" }),
    ]) {
      try {
        f();
      } catch (e) {
        acc += e.message.length + (e instanceof RangeError) * 2;
      }
    }
    acc +=
      String(Math.max).length +
      Function.prototype.toString.call(Array.prototype.map).length +
      String(bound).length +
      String(
        class A {
          m() {}
        },
      ).length;
    sink += acc;
  });
};
features.lib_objects = async function () {
  const proto = {
    base: 1,
    toString() {
      return "P";
    },
  };
  rounds(r => {
    let acc = 0;
    const holey = [1, , 3, , 5];
    const dict = {};
    for (let i = 0; i < 40; i++) dict["k" + i] = i;
    for (let i = 0; i < 30; i += 2) delete dict["k" + i];
    for (let i = 0; i < 300; i++) {
      const o = Object.create(proto);
      o["p" + (i % 5)] = i;
      if (i % 50 === 0) Object.setPrototypeOf(o, { base: 2 });
      for (const k in o) {
        if (k in dict) acc++;
        acc += k.length;
      }
      for (const k in holey) acc += k in holey ? 1 : 0;
      acc +=
        [...holey].length +
        Array.from(holey).length +
        (i >>> 1) +
        ("" + i != i ? 1 : 0) +
        `${o}`.length +
        Object(i).valueOf();
      const arr = [];
      arr[70 + (i % 5)] = i;
      acc += arr.length;
      const big = new Array(200).fill(i);
      big.length = 3;
      acc += big.length;
      acc += [1, 2].concat(i, "x").length + Object.keys(dict).length + Object.entries(holey).length;
    }
    for (const k in dict) acc += dict[k] | 0;
    Object.defineProperty(globalThis, "__wl_g" + (r % 3), { value: r, configurable: true, writable: true });
    acc += Object.getPrototypeOf(globalThis) ? 1 : 0;
    const s = new Set([1, 2, 3, r]);
    acc += new Set(s).size + [...s.entries()].length;
    s.forEach(v => (acc += v));
    const tag = (st, ...v) => st.raw.length + v.length;
    for (let i = 0; i < 20; i++) acc += tag`a${i}b${r}c`;
    function f() {
      return arguments.length + [...arguments].length;
    }
    acc += f(...[1, 2, 3]) + Math.max(...holey.filter(Boolean));
    sink += acc;
  });
};
features.lib_proxy = async function () {
  const handler = {
    get(t, k, rcv) {
      return k === "virtual" ? 42 : Reflect.get(t, k, rcv);
    },
    has(t, k) {
      return k === "virtual" || k in t;
    },
    ownKeys(t) {
      return [...Reflect.ownKeys(t), "virtual"];
    },
    getOwnPropertyDescriptor(t, k) {
      return k === "virtual"
        ? { value: 42, enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(t, k);
    },
  };
  const frozen = new Proxy(PROXY_TARGET, {
    get(t, k) {
      return Reflect.get(t, k);
    },
  });
  rounds(() => {
    let acc = 0;
    const p = new Proxy({ a: 1, b: { c: 2 } }, handler);
    for (let i = 0; i < 2000; i++) {
      acc += p.virtual + p.a + (p.b?.c | 0) + ("virtual" in p) + frozen.fixed;
    }
    acc += Object.keys(p).length + JSON.stringify(p).length + { ...p }.virtual;
    sink += acc;
  });
};
features.lib_regex = async function () {
  rounds(r => {
    let acc = 0;
    for (const re of REGEXES) {
      re.lastIndex = 0;
      if (re.global) {
        acc += (REGEX_TEXT.match(re)?.length | 0) + REGEX_TEXT.replace(re, "").length;
      } else acc += re.test(REGEX_TEXT) + (re.exec(REGEX_TEXT)?.index | 0);
    }
    acc +=
      RegExp("^" + ["alpha", "beta", "gamma", "delta"][r % 4] + "\\d*$", "i").test("Beta12") +
      new RegExp(`(?:${["日本", "語", "テキスト"].join("|")})+`, "gu").exec(REGEX_TEXT)?.index;
    sink += acc;
  });
};
features.lib_runtime_compile = async function () {
  rounds(r => {
    if (r % 50 === 0) {
      const f = new Function(
        "s",
        "// ünïcödé\nreturn /(?<w>[\\p{L}\\p{N}]+)|\\u{1F600}/u.exec(s)?.[0].length ?? " + (r % 7),
      );
      sink += f("hello 日本 😀 " + r);
    }
  });
};
features.lib_bigint64 = async function () {
  rounds(r => {
    const b = new BigInt64Array(64);
    const u = new BigUint64Array(b.buffer);
    for (let i = 0; i < 64; i++) b[i] = BigInt(i * r) - 5n;
    sink +=
      Number((b[3] + u[4]) & 0xffn) +
      ("3" in b) +
      Object.getOwnPropertyDescriptor(b, "2").writable +
      new Int32Array(8).length +
      new Uint16Array(8).length +
      new Int8Array(4).length;
  });
};
features.lib_modns = async function () {
  const ns = await import("./lib-ns.js");
  const ns2 = await import("./lib-ns.js");
  rounds(() => {
    let acc = 0;
    for (let i = 0; i < 1000; i++)
      acc += ns.alpha + ns.beta(i) + ns2.gamma.length + (ns.delta?.x | 0) + (ns.renamed | 0);
    acc += Object.keys(ns).length + ("alpha" in ns) + ns[Symbol.toStringTag].length;
    sink += acc;
  });
};
// -- DFG/FTL node shapes and IC kinds common in bundled library code: small functions called from one driver loop --
const SYM_A = Symbol("a"),
  SYM_B = Symbol.for("b");
function mixin(Base, i) {
  return class extends Base {
    get tag() {
      return "m" + i;
    }
    m() {
      return i + super.m();
    }
  };
}
class Root {
  m() {
    return 1;
  }
}
const MIXED = Array.from({ length: 8 }, (_, i) => mixin(i % 2 ? Root : mixin(Root, 100 + i), i));
class Priv {
  #x = 1;
  #y = "y";
  static read(o) {
    return o.#x + o.#y.length;
  }
  has(o) {
    return #x in o;
  }
  bump() {
    this.#x++;
    return this.#x;
  }
}
class Priv2 extends Priv {
  #z = 3;
  get z() {
    return this.#z;
  }
}
function jsSplice(i) {
  const a = [1, 2, 3, 4, 5, i];
  const r = a.splice(1, 2);
  a.splice(0, 0, i);
  return a.length + r.length;
}
function jsIncludes(words, i) {
  return (
    words.includes(i & 1 ? "beta" : "zeta") + words.indexOf("gamma") + [i, 2, 3].includes(3) + [1.5, 2.5].indexOf(2.5)
  );
}
function jsGetter(k) {
  return this[k];
}
function jsToESM(mod) {
  const d = Object.create(Object.getPrototypeOf(mod));
  for (const f of Object.getOwnPropertyNames(mod))
    if (!Object.prototype.hasOwnProperty.call(d, f))
      Object.defineProperty(d, f, { get: jsGetter.bind(mod, f), enumerable: true });
  return d;
}
function jsExport(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true, configurable: true });
  return target;
}
function jsDefineData(target, i) {
  Object.defineProperty(target, "v" + (i & 7), { value: i, writable: true, enumerable: false, configurable: true });
  return target;
}
function jsObjEq(a, b) {
  return (a === b) + (a == b) + (a !== b);
}
function jsSymEq(s) {
  return (s === SYM_A) + (SYM_B === s);
}
function jsBoolEq(b1, b2) {
  return (b1 === b2) + (b1 == b2);
}
function jsBits(i, r) {
  return Number.isNaN(i / (i & 1)) + ~i + ~~(i / 3) + (i >>> (i & 7)) + (i << (r & 3));
}
function jsMixed(i) {
  const inst = new MIXED[i & 7]();
  return inst.m() + inst.tag.length;
}
function jsPriv(i) {
  const p = i & 1 ? new Priv() : new Priv2();
  return Priv.read(p) + p.has(p) + p.bump() + (p instanceof Priv2 ? p.z : 0);
}
function jsCustom(resp, url, buf, hdrs) {
  return resp.status + resp.ok + url.pathname.length + buf.byteLength + hdrs.get("a").length;
}
function jsTypeofFn(x) {
  return (typeof x === "function") + (typeof x === "undefined") + (x == null);
}
function jsSymPut(i) {
  const so = {};
  so[SYM_A] = i;
  so[SYM_B] = 2;
  return so[SYM_A];
}
function jsSplitLit() {
  return "red,green,blue,cyan".split(/,/).length + "a b  c".split(/\s+/).length;
}
function jsColl(i, m, st) {
  return (m.get(i & 3) | 0) + st.has(i & 1 ? "a" : "c");
}
function jsMulGeneric(i) {
  return ((i & 1 ? 2n : 3n) * 2n > 1n ? 1 : 0) + "3" * (i & 7);
}
const MAPPERS = [x => x + 1, x => x * 2, x => -x, x => x | 0, x => x & 3, x => String(x).length, x => x > 2, x => [x]];
function jsSpecies(a, i) {
  return a.map(MAPPERS[i & 7]).length + a.filter(MAPPERS[(i >> 3) & 7]).length + a.slice(1).length;
}
features.lib_jitshapes = async function () {
  const resp = new Response("x", { status: 201 }),
    url = new URL("https://a.b/c?d=1"),
    buf = Buffer.alloc(16),
    hdrs = new Headers({ a: "1" });
  const words = ["alpha", "beta", "gamma", "delta"],
    mods = Array.from({ length: 64 }, (_, i) => ({ a: i, b: 2, c: 3, ["k" + (i % 5)]: 1 }));
  const m = new Map([
      [1, 1],
      [2, 2],
    ]),
    st = new Set(["a", "b"]),
    target = {};
  const N = ROUNDS() * 400;
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc +=
      jsSplice(i) +
      jsIncludes(words, i) +
      jsObjEq(mods[i & 63], mods[(i >> 1) & 63]) +
      jsSymEq(i & 3 ? SYM_A : "s") +
      jsBoolEq((i & 1) === 0, (i & 2) === 0) +
      jsBits(i, i >> 4);
    acc +=
      jsMixed(i) +
      jsPriv(i) +
      jsCustom(resp, url, buf, hdrs) +
      jsTypeofFn(i & 1 ? jsBits : i) +
      jsSymPut(i) +
      jsColl(i, m, st) +
      jsMulGeneric(i) +
      jsSpecies([i, 2, 3, 4], i);
    if ((i & 15) === 0) {
      acc +=
        Object.keys(jsToESM(mods[i & 63])).length +
        Object.keys(jsExport({}, { a: () => 1, b: () => 2, c: () => i })).length;
      jsDefineData(target, i);
      acc += jsSplitLit();
    }
  }
  sink += acc;
};
const TOPALT = [
  /error|warning|notice|info|debug/,
  /'[^']*'|"[^"]*"|`[^`]*`/g,
  /\d+|[a-z]+|\s+|[A-Z]+|[^\w\s]/g,
  /GET|POST|PUT|DELETE|PATCH|HEAD/,
  /https?:|file:|data:|blob:/,
  /ä|ö|ü|ß/u,
];
features.lib_regex2 = async function () {
  const text = "GET /x 200 'a' \"b\" `c` error: 12 ab CD ; https://q file: ä\n".repeat(20);
  rounds(() => {
    let acc = 0;
    for (const re of TOPALT) {
      re.lastIndex = 0;
      acc += re.global ? text.match(re).length : re.exec(text)?.index | 0;
    }
    acc += text.replace(/\r\n|\n/g, " ").length;
    sink += acc;
  });
};
// -- more runtime slow paths seen in CLI apps: JSON of mixed-width strings, Object.assign from indexed sources, sparse writes,
//    generic arithmetic/equality in Baseline, runtime-compiled code with .call/.apply/void, custom accessors, AbortSignal-aware
//    events, TLS verify errors, BigInt64 views --
const PROTO_SWAP = {
    toString() {
      return "a";
    },
  },
  PROTO_SWAP2 = {
    toString() {
      return "b";
    },
  };
function jsAssignIdx(src) {
  return Object.assign({}, src);
}
function jsSparse(a, i) {
  a[1000 + (i & 7)] = i;
  return a.length;
}
function jsGeneric(a, b) {
  const p = a * b;
  return (typeof p === "bigint" ? Number(p) : p) + (a != b) + `${a}`.length;
}
function jsStrictPut(o, k, v) {
  "use strict";
  o[k] = v;
  return o;
}
features.lib_runtime2 = async function () {
  const u16 = "日本語 ✓ ";
  const srcs = [[1, 2, 3], { 0: "a", 1: "b", length: 2 }, "str", { a: 1 }];
  const objs = Array.from({ length: 8 }, (_, i) => (i & 1 ? Object.create(PROTO_SWAP) : Object.create(PROTO_SWAP2)));
  rounds(r => {
    let acc = 0;
    acc +=
      JSON.stringify({ s: u16 + r, n: [r, r * 1000, -r, 123456], o: { k: r } }).length +
      JSON.stringify([u16, 1, 2, 3, r]).length;
    for (let i = 0; i < 200; i++) {
      acc +=
        Object.keys(jsAssignIdx(srcs[i & 3])).length +
        jsSparse([], i) +
        jsGeneric(i & 1 ? 2n : i, i & 1 ? 3n : "4") +
        jsGeneric(
          {
            valueOf() {
              return 2;
            },
          },
          3,
        );
      const o = jsStrictPut({}, i & 1 ? Symbol.iterator : i, i);
      acc += Object.getOwnPropertySymbols(o).length;
      acc +=
        String(objs[i & 7]).length +
        (i % 50 === 0 ? (Object.setPrototypeOf(objs[i & 7], i & 2 ? PROTO_SWAP : PROTO_SWAP2), 1) : 0);
      const a = [];
      a.length = 5;
      Object.defineProperty(a, "0", { value: 1, writable: false });
      acc += a.length;
      acc +=
        new URL("../x/y?q=" + i, "https://example.com:8443/a/b/").href.length +
        new URL("file:///tmp/" + i).pathname.length;
    }
    if (r % 40 === 0) {
      const fn = new Function(
        "a",
        "b",
        "void a; return Math.max.call(null, a, b) + Math.min.apply(null, [a, b]) + (typeof b === 'undefined' ? 1 : 0);",
      );
      acc += fn(r, 2);
    }
    acc += new BigInt64Array(new ArrayBuffer(64), 8, 4).length + new BigUint64Array(new ArrayBuffer(16)).length;
    sink += acc;
  });
};
features.lib_events_signal = async function () {
  const { events: ev } = await (async () => ({ events: await import("node:events") }))();
  for (let r = 0; r < 20; r++) {
    const ac = new AbortController();
    const ee = new ev.EventEmitter();
    ev.setMaxListeners?.(20, ac.signal);
    ev.getEventListeners?.(ac.signal, "abort");
    const p = ev.once(ee, "ready", { signal: ac.signal });
    ee.emit("ready", r);
    sink += (await p)[0];
    const disp = ev.addAbortListener?.(ac.signal, () => sink++);
    ac.abort();
    disp?.[Symbol.dispose]?.();
    try {
      await ev.once(ee, "never", { signal: AbortSignal.abort() });
    } catch (e) {
      sink += e.name.length;
    }
    const et = new EventTarget();
    ev.once(et, "x").then(() => sink++);
    et.dispatchEvent(new Event("x"));
  }
};
// -- JIT tiers and runtime slow paths a large bundle reaches, one shape per feature (lib_jit_*) --
const JIT_N = () => ROUNDS() * 500;
function jitReplaceEmpty(s) {
  return s.replace(/[aeiou]/g, "").length + s.replace(/\s+/g, "").length;
}
features.lib_jit_replace_empty = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N(); i < n; i++) acc += jitReplaceEmpty("hello world " + (i & 7));
  sink += acc;
};
const JIT_KEYS = Object.keys({ "red,green,blue": 1, "a b  c": 2 });
function jitSplitKey(k) {
  return k.split(/,/).length + k.split(/\s+/).length;
}
features.lib_jit_split_atom = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N() / 16; i < n; i++) acc += jitSplitKey(JIT_KEYS[i & 1]);
  sink += acc;
};
const JIT_WORDS = ["alpha", "beta", "gamma", "delta"];
function jitIncludes(s) {
  return JIT_WORDS.includes(s) + JIT_WORDS.indexOf(s);
}
features.lib_jit_includes = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N(); i < n; i++) acc += jitIncludes(JIT_WORDS[i & 3] + (i & 4 ? "" : "x"));
  sink += acc;
};
class SubArray extends Array {}
features.lib_jit_species = async function () {
  const src = [
    Array.from({ length: 5000 }, (_, i) => i & 255),
    Array.from({ length: 5000 }, (_, i) => i + 0.5),
    Array.from({ length: 5000 }, (_, i) => ({ i })),
    SubArray.from({ length: 5000 }, (_, i) => i),
    { length: 5000 },
  ];
  const f = x => x,
    g = x => !!x;
  let acc = 0;
  for (let r = 0; r < 60; r++) {
    const a = src[r % 5];
    acc += Array.prototype.map.call(a, f).length + Array.prototype.filter.call(a, g).length;
  }
  sink += acc;
};
const JIT_MIXED = [0, 1, "", "x", null, undefined, {}, [], 1.5, NaN, true, false],
  JIT_SINK = [];
function jitNot(v) {
  const b = !v;
  JIT_SINK[0] = b;
  return b;
}
features.lib_jit_not_untyped = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N(); i < n; i++) acc += jitNot(JIT_MIXED[i % JIT_MIXED.length]) ? 1 : 0;
  sink += acc;
};
function jitStatics(s) {
  /(\w+)@(\w+)/.test(s);
  return RegExp.$1.length + RegExp.lastMatch.length + RegExp.input.length;
}
features.lib_jit_regexp_statics = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N(); i < n; i++) acc += jitStatics("user" + (i & 3) + "@host");
  sink += acc;
};
const JIT_OBJ = {},
  JIT_MIX2 = [{}, undefined, 1, "s", null, [], {}];
function jitObjEq(o, x) {
  const e = o === x;
  JIT_SINK[1] = e;
  return e ? 1 : 0;
}
function jitObjEqBranch(o, x) {
  if (o === x) return 1;
  return 0;
}
features.lib_jit_objeq = async function () {
  let acc = 0;
  for (let i = 0, n = JIT_N(); i < n; i++)
    acc += jitObjEq(JIT_OBJ, JIT_MIX2[i % 7]) + jitObjEqBranch(JIT_OBJ, JIT_MIX2[(i >> 1) % 7]);
  sink += acc;
};
features.lib_jit_global_put = async function () {
  for (let i = 0; i < 3; i++)
    sink += new Function(
      "x",
      "for (var j = 0; j < 2000; j++) { wlGlobal = (typeof wlGlobal === 'number' ? wlGlobal : 0) + x; } return wlGlobal;",
    )(i);
};
const jitThenable = v => ({
  then(res) {
    queueMicrotask(() => res(v));
  },
});
class SubPromise extends Promise {}
async function jitAwaits(i) {
  const x = await jitThenable(i);
  const y = await SubPromise.resolve(i);
  const z = await new Promise(r => r(Promise.resolve(i)));
  return x + y + z;
}
async function* jitAgen() {
  yield Promise.resolve(1);
  yield jitThenable(2);
}
features.lib_jit_promise_thenables = async function () {
  let acc = 0;
  for (let i = 0; i < 200; i++) acc += await jitAwaits(i);
  acc += await Promise.resolve(jitThenable(3));
  acc += await new SubPromise(r => r(4)).then(v => v + 1);
  for await (const v of jitAgen()) acc += v;
  sink += acc;
};
features.lib_jit_typed_from = async function () {
  let acc = 0;
  const like = { length: 8, 0: 1, 1: 2, 7: 9 };
  for (let i = 0; i < 2000; i++) {
    const u = new Uint32Array(like);
    u.set([i, i + 1], 2);
    acc += u[2] + new Float64Array([1.5, i]).length;
  }
  sink += acc;
};
export const checksum = () => sink;
