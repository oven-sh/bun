// Symbolic algebra: expressions with units, a parser, simplification by rules, derivatives, integrals of polynomials, solving, evaluation over intervals, a plotter
type Unit = Readonly<Record<string, number>>;
abstract class Expr {
  static made = 0;
  readonly id = ++Expr.made;
  abstract readonly kind: string;
  abstract readonly parts: readonly Expr[];
  abstract build(parts: readonly Expr[]): Expr;
  abstract value(env: Env): number;
  abstract derive(x: string): Expr;
  abstract text(level: number): string;
  toString() {
    return this.text(0);
  }
  equals(o: Expr): boolean {
    return this === o || (this.kind === o.kind && this.text(0) === o.text(0));
  }
  *walk(): Generator<Expr> {
    yield this;
    for (const p of this.parts) yield* p.walk();
  }
  get size(): number {
    let n = 0;
    for (const _ of this.walk()) n++;
    return n;
  }
  has(x: string): boolean {
    for (const e of this.walk()) if (e instanceof Var && e.name === x) return true;
    return false;
  }
  replace(x: string, by: Expr): Expr {
    return this instanceof Var &&
      this.name === x ? by : this.parts.length ? this.build(this.parts.map(p => p.replace(x,
      by))) : this;
  }
  plus(o: Expr | number): Expr {
    return new Sum([this, of(o)]);
  }
  times(o: Expr | number): Expr {
    return new Product([this, of(o)]);
  }
  power(o: Expr | number): Expr {
    return new Power(this, of(o));
  }
  minus(o: Expr | number): Expr {
    return new Sum([this, new Product([Num.of(-1), of(o)])]);
  }
  over(o: Expr | number): Expr {
    return new Product([this, new Power(of(o), Num.of(-1))]);
  }
  interval(env: Record<string, Interval>): Interval {
    throw new TypeError("no interval of " + this.kind);
  }
}
class Env {
  constructor(readonly vars: Readonly<Record<string, number>>) {
  }
  get(n: string): number {
    const v = this.vars[n];
    if (v === undefined) throw new ReferenceError("no value of " + n);
    return v;
  }
}
class Interval {
  constructor(readonly low: number, readonly high: number) {
    if (low > high) throw new RangeError(`${low}..${high}`);
  }
  plus(o: Interval) {
    return new Interval(this.low + o.low, this.high + o.high);
  }
  times(o: Interval) {
    const all = [this.low * o.low, this.low * o.high, this.high * o.low, this.high * o.high];
    return new Interval(Math.min(...all), Math.max(...all));
  }
  power(n: number) {
    if (n % 2 === 0 && this.low < 0 && this.high > 0) return new Interval(0,
      Math.max(this.low ** n, this.high ** n));
    const a = this.low ** n, b = this.high ** n;
    return new Interval(Math.min(a, b), Math.max(a, b));
  }
  toString() {
    return `[${+this.low.toFixed(4)}, ${+this.high.toFixed(4)}]`;
  }
}
const of = (v: Expr | number | string): Expr => (typeof v === "number" ? Num.of(v) : typeof v === "string" ? new Var(v) : v);
class Num extends Expr {
  readonly kind = "num";
  readonly parts = [];
  static readonly #kept = new Map<number, Num>();
  private constructor(readonly n: number) {
    super();
  }
  static of(n: number): Num {
    let k = Num.#kept.get(n);
    if (!k) Num.#kept.set(n, (k = new Num(n)));
    return k;
  }
  build() {
    return this;
  }
  value() {
    return this.n;
  }
  derive() {
    return Num.of(0);
  }
  text(level: number) {
    const t = Number.isInteger(this.n) ? String(this.n) : String(+this.n.toFixed(6));
    return this.n < 0 && level > 1 ? `(${t})` : t;
  }
  interval() {
    return new Interval(this.n, this.n);
  }
}
class Var extends Expr {
  readonly kind = "var";
  readonly parts = [];
  constructor(readonly name: string) {
    super();
  }
  build() {
    return this;
  }
  value(env: Env) {
    return env.get(this.name);
  }
  derive(x: string) {
    return Num.of(x === this.name ? 1 : 0);
  }
  text() {
    return this.name;
  }
  interval(env: Record<string, Interval>) {
    const i = env[this.name];
    if (!i) throw new ReferenceError("no interval of " + this.name);
    return i;
  }
}
class Sum extends Expr {
  readonly kind = "sum";
  constructor(readonly parts: readonly Expr[]) {
    super();
  }
  build(parts: readonly Expr[]) {
    return new Sum(parts);
  }
  value(env: Env) {
    let s = 0;
    for (const p of this.parts) s += p.value(env);
    return s;
  }
  derive(x: string) {
    return new Sum(this.parts.map(p => p.derive(x)));
  }
  text(level: number) {
    let out = "";
    this.parts.forEach((p, i) => {
      const t = p.text(1);
      out += i === 0 ? t : t[0] === "-" ? " - " + t.slice(1) : " + " + t;
  });
    return level > 1 ? `(${out})` : out;
  }
  interval(env: Record<string, Interval>) {
    return this.parts.map(p => p.interval(env)).reduce((a, b) => a.plus(b));
  }
}
class Product extends Expr {
  readonly kind = "product";
  constructor(readonly parts: readonly Expr[]) {
    super();
  }
  build(parts: readonly Expr[]) {
    return new Product(parts);
  }
  value(env: Env) {
    let s = 1;
    for (const p of this.parts) s *= p.value(env);
    return s;
  }
  derive(x: string) {
    return new Sum(this.parts.map((p, i) => new Product(this.parts.map((q,
      k) => (k === i ? p.derive(x) : q)))));
  }
  text(level: number) {
    let parts = this.parts, sign = "";
    const first = parts[0];
    if (first instanceof Num && first.n === -1 && parts.length > 1) {
      sign = "-";
      parts = parts.slice(1);
    }
    const top: string[] = [], bottom: string[] = [];
    for (const p of parts) if (p instanceof Power && p.exponent instanceof Num &&
      p.exponent.n < 0) bottom.push(p.exponent.n === -1 ? p.base.text(3) : new Power(p.base,
      Num.of(-p.exponent.n)).text(3));
    else top.push(p.text(top.length || sign ? 2 : 1.5));
    const t = sign + (top.join("*") ||
      "1") + (bottom.length ? "/" + (bottom.length > 1 ? `(${bottom.join("*")})` : bottom[0]) : "");
    return level > 2 || (level > 1.5 && sign) ? `(${t})` : t;
  }
  interval(env: Record<string, Interval>) {
    return this.parts.map(p => p.interval(env)).reduce((a, b) => a.times(b));
  }
}
class Power extends Expr {
  readonly kind = "power";
  readonly parts: readonly [Expr, Expr];
  constructor(readonly base: Expr, readonly exponent: Expr) {
    super();
    this.parts = [base, exponent];
  }
  build([b, e]: readonly Expr[]) {
    return new Power(b, e);
  }
  value(env: Env) {
    return Math.pow(this.base.value(env), this.exponent.value(env));
  }
  derive(x: string): Expr {
    if (!this.exponent.has(x)) return new Product([this.exponent, new Power(this.base,
      this.exponent.plus(-1)), this.base.derive(x)]);
    return new Product([this, new Sum([new Product([this.exponent.derive(x), new Call("ln",
      this.base)]), new Product([this.exponent, this.base.derive(x), new Power(this.base,
      Num.of(-1))])])]);
  }
  text(level: number) {
    const t = this.base.text(3) + "^" + this.exponent.text(3);
    return level > 2.5 ? `(${t})` : t;
  }
  interval(env: Record<string, Interval>) {
    if (!(this.exponent instanceof Num) || !Number.isInteger(this.exponent.n) ||
      this.exponent.n < 0) throw new TypeError("no interval of a power");
    return this.base.interval(env).power(this.exponent.n);
  }
}
class Call extends Expr {
  readonly kind = "call";
  readonly parts: readonly [Expr];
  static readonly functions: Record<string, {
    run: (x: number) => number;
    derive: (x: Expr) => Expr
  }
  > = {
    sin: {
      run: Math.sin, derive: x => new Call("cos", x)
  }, cos: {
      run: Math.cos, derive: x => new Product([Num.of(-1), new Call("sin", x)])
  }, exp: {
      run: Math.exp, derive: x => new Call("exp", x)
  }, ln: {
      run: Math.log, derive: x => new Power(x, Num.of(-1))
  }, sqrt: {
      run: Math.sqrt, derive: x => new Product([Num.of(0.5), new Power(x, Num.of(-0.5))])
    }
};
  constructor(readonly name: string, readonly of: Expr) {
    super();
    if (!Call.functions[name]) throw new ReferenceError("no function " + name);
    this.parts = [of];
  }
  build([x]: readonly Expr[]) {
    return new Call(this.name, x);
  }
  value(env: Env) {
    return Call.functions[this.name].run(this.of.value(env));
  }
  derive(x: string) {
    return new Product([Call.functions[this.name].derive(this.of), this.of.derive(x)]);
  }
  text() {
    return `${this.name}(${this.of.text(0)})`;
  }
}
function parse(source: string): Expr {
  const tokens = source.match(/\d+(?:\.\d+)?|[a-z]\w*|[-+*\/^()]|\S/gi) ?? [];
  let i = 0;
  const take = (t: string) => (tokens[i] === t ? (i++, true) : false);
  const sum = (): Expr => {
    const parts = [product()];
    for (;;) {
      if (take("+")) parts.push(product());
      else if (take("-")) parts.push(new Product([Num.of(-1), product()]));
      else return parts.length === 1 ? parts[0] : new Sum(parts);
    }
};
  const product = (): Expr => {
    const parts = [unary()];
    for (;;) {
      if (take("*")) parts.push(unary());
      else if (take("/")) parts.push(new Power(unary(), Num.of(-1)));
      else if (tokens[i] && /^[a-z(]/i.test(tokens[i])) parts.push(unary());
      else return parts.length === 1 ? parts[0] : new Product(parts);
    }
};
  const unary = (): Expr => {
    if (take("-")) return new Product([Num.of(-1), unary()]);
    const base = atom();
    return take("^") ? new Power(base, unary()) : base;
};
  const atom = (): Expr => {
    const t = tokens[i++];
    if (t === undefined) throw new SyntaxError("ends: " + source);
    if (/^\d/.test(t)) return Num.of(+t);
    if (t === "(") {
      const e = sum();
      if (!take(")")) throw new SyntaxError("open ( in " + source);
      return e;
    }
    if (/^[a-z]/i.test(t)) {
      if (Call.functions[t] && take("(")) {
        const e = sum();
        if (!take(")")) throw new SyntaxError("open call in " + source);
        return new Call(t, e);
      }
      return new Var(t);
    }
    throw new SyntaxError(`unexpected ${t} in ${source}`);
};
  const e = sum();
  if (i < tokens.length) throw new SyntaxError("more in " + source);
  return e;
}
type Rule = {
  name: string;
  apply: (e: Expr) => Expr | null
};
class Simplifier {
  readonly uses: Record<string, number> = {
};
  readonly #kept = new Map<string, Expr>();
  static readonly order = (a: Expr, b: Expr): number => {
    const rank = (e: Expr) => (e instanceof Num ? 0 : e instanceof Var ? 1 : e instanceof Power ? 2 : 3);
    const x = a.text(0), y = b.text(0);
    return rank(a) - rank(b) || (x < y ? -1 : x > y ? 1 : 0);
};
  readonly rules: Rule[] = [{ name: "flat", apply: e => {
    if (!(e instanceof Sum || e instanceof Product)) return null;
    if (!e.parts.some(p => p.kind === e.kind)) return null;
    return e.build(e.parts.flatMap(p => (p.kind === e.kind ? p.parts : [p])));
  }
}, { name: "constants", apply: e => {
    if (!(e instanceof Sum || e instanceof Product)) return null;
    const nums = e.parts.filter((p): p is Num => p instanceof Num);
    const unit = e instanceof Sum ? 0 : 1;
    if (nums.length < 2 && !(nums.length === 1 && nums[0].n === unit &&
      e.parts.length > 1)) return null;
    const n = nums.reduce((a, b) => (e instanceof Sum ? a + b.n : a * b.n), unit);
    const rest = e.parts.filter(p => !(p instanceof Num));
    return e.build(n === unit && rest.length ? rest : [Num.of(n), ...rest]);
  }
}, { name: "zero", apply: e => (e instanceof Product && e.parts.some(p => p instanceof Num &&
  p.n === 0) ? Num.of(0) : null) }, { name: "single", apply: e => ((e instanceof Sum ||
  e instanceof Product) && e.parts.length === 1 ? e.parts[0] : null) }, { name: "power",
  apply: e => {
    if (!(e instanceof Power)) return null;
    const {
      base, exponent
  } = e;
    if (exponent instanceof Num) {
      if (exponent.n === 0) return Num.of(1);
      if (exponent.n === 1) return base;
      if (base instanceof Num) return Num.of(base.n ** exponent.n);
      if (base instanceof Power) return new Power(base.base, new Product([base.exponent,
        exponent]));
      if (base instanceof Product) return new Product(base.parts.map(p => new Power(p,
        exponent)));
    }
    return base instanceof Num && (base.n === 1 || base.n === 0) ? base : null;
  }
}, { name: "like terms", apply: e => {
    if (!(e instanceof Sum)) return null;
    const groups = new Map<string, {
      n: number;
      e: Expr | null
    }
    >();
    for (const p of e.parts) {
      let n = 1, rest: Expr | null = p;
      if (p instanceof Num) {
        n = p.n;
        rest = null;
    } else if (p instanceof Product && p.parts[0] instanceof Num) {
        n = p.parts[0].n;
        rest = p.parts.length === 2 ? p.parts[1] : new Product(p.parts.slice(1));
      }
      const key = rest ? rest.text(0) : "";
      const g = groups.get(key);
      if (g) g.n += n;
      else groups.set(key, { n, e: rest });
    }
    if (groups.size === e.parts.length) return null;
    return new Sum([...groups.values()].map(g => (g.e ? new Product([Num.of(g.n),
      g.e]) : Num.of(g.n))));
  }
}, { name: "like factors", apply: e => {
    if (!(e instanceof Product)) return null;
    const groups = new Map<string, {
      base: Expr;
      exponents: Expr[]
    }
    >();
    for (const p of e.parts) {
      const base = p instanceof Power ? p.base : p,
        exponent = p instanceof Power ? p.exponent : Num.of(1);
      const key = base instanceof Num ? "#" + groups.size : base.text(0);
      const g = groups.get(key);
      if (g) g.exponents.push(exponent);
      else groups.set(key, { base, exponents: [exponent] });
    }
    if (groups.size === e.parts.length) return null;
    return new Product([...groups.values()].map(g => (g.exponents.length === 1 ? (g.exponents[0] instanceof Num &&
      g.exponents[0].n === 1 ? g.base : new Power(g.base, g.exponents[0])) : new Power(g.base,
      new Sum(g.exponents)))));
  }
}, { name: "known calls", apply: e => {
    if (!(e instanceof Call)) return null;
    if (e.of instanceof Num && ((e.of.n === 0 && e.name !== "ln") || (e.of.n === 1 && ["ln",
      "sqrt"].includes(e.name)))) return Num.of(Call.functions[e.name].run(e.of.n));
    if (e.name === "ln" && e.of instanceof Call && e.of.name === "exp") return e.of.of;
    if (e.name === "exp" && e.of instanceof Call && e.of.name === "ln") return e.of.of;
    return null;
  }
}, { name: "sin2+cos2", apply: e => {
    if (!(e instanceof Sum)) return null;
    const square = (p: Expr, f: string) => (p instanceof Power && p.exponent instanceof Num &&
      p.exponent.n === 2 && p.base instanceof Call &&
      p.base.name === f ? p.base.of.text(0) : null);
    for (const p of e.parts) {
      const a = square(p, "sin");
      if (a === null) continue;
      const q = e.parts.find(x => square(x, "cos") === a);
      if (q) return new Sum([Num.of(1), ...e.parts.filter(x => x !== p && x !== q)]);
    }
    return null;
  }
}, { name: "order", apply: e => {
    if (!(e instanceof Sum || e instanceof Product)) return null;
    const sorted = [...e.parts].sort(Simplifier.order);
    return sorted.every((p, i) => p === e.parts[i]) ? null : e.build(sorted);
  }
}];
  run(e: Expr): Expr {
    const key = e.text(0);
    const kept = this.#kept.get(key);
    if (kept) return kept;
    let now = e;
    for (let round = 0; round < 60; round++) {
      if (now.parts.length) {
        const parts = now.parts.map(p => this.run(p));
        if (parts.some((p, i) => p !== now.parts[i])) now = now.build(parts);
      }
      let next: Expr | null = null;
      for (const r of this.rules) if ((next = r.apply(now))) {
        this.uses[r.name] = (this.uses[r.name] ?? 0) + 1;
        break;
      }
      if (!next) break;
      now = next;
    }
    this.#kept.set(key, now);
    return now;
  }
}
function expand(e: Expr): Expr {
  const parts = e.parts.map(expand);
  const x = parts.length ? e.build(parts) : e;
  if (x instanceof Power && x.exponent instanceof Num && Number.isInteger(x.exponent.n) &&
    x.exponent.n > 1 && x.exponent.n < 7 &&
    x.base instanceof Sum) return expand(new Product(Array.from({ length: x.exponent.n },
    () => x.base)));
  if (x instanceof Product) {
    const i = x.parts.findIndex(p => p instanceof Sum);
    if (i >= 0) return expand(new Sum(x.parts[i].parts.map(t => new Product([...x.parts.slice(0,
      i), t, ...x.parts.slice(i + 1)]))));
  }
  return x;
}
function coefficients(e: Expr, x: string, s: Simplifier): number[] {
  const out: number[] = [];
  const sum = s.run(expand(e));
  for (const t of sum instanceof Sum ? sum.parts : [sum]) {
    let n = 1, d = 0;
    for (const p of t instanceof Product ? t.parts : [t]) {
      if (p instanceof Num) n *= p.n;
      else if (p instanceof Var && p.name === x) d++;
      else if (p instanceof Power && p.base instanceof Var && p.base.name === x &&
        p.exponent instanceof Num && Number.isInteger(p.exponent.n) &&
        p.exponent.n > 0) d += p.exponent.n;
      else throw new TypeError("not a polynomial: " + t);
    }
    out[d] = (out[d] ?? 0) + n;
  }
  return Array.from(out, v => v ?? 0);
}
function integrate(e: Expr, x: string, s: Simplifier): Expr {
  return s.run(new Sum(coefficients(e, x, s).map((c, d) => new Product([Num.of(c / (d + 1)),
    new Power(new Var(x), Num.of(d + 1))]))));
}
function solve(e: Expr, x: string, from: number, to: number): number[] {
  const d = e.derive(x), out: number[] = [];
  for (let i = 0; i <= 40; i++) {
    let v = from + ((to - from) * i) / 40;
    for (let k = 0; k < 60; k++) {
      const f = e.value(new Env({ [x]: v })), g = d.value(new Env({ [x]: v }));
      if (!Number.isFinite(f) || Math.abs(g) < 1e-12) break;
      const next = v - f / g;
      if (Math.abs(next - v) < 1e-12) {
        if (next >= from && next <= to &&
          !out.some(o => Math.abs(o - next) < 1e-6)) out.push(next);
        break;
      }
      v = next;
    }
  }
  return out.sort((a, b) => a - b);
}
function plot(e: Expr, x: string, from: number, to: number, width: number,
  height: number): string {
  const ys = Array.from({ length: width }, (_,
    i) => e.value(new Env({ [x]: from + ((to - from) * i) / (width - 1) })));
  const low = Math.min(...ys), high = Math.max(...ys);
  return Array.from({ length: height }, (_,
    r) => ys.map(y => (Math.round(((high - y) / (high - low ||
    1)) * (height - 1)) === r ? "*" : " ")).join("").trimEnd()).join("/");
}
const s = new Simplifier();
const texts = ["x + x", "2*x*3*y", "x*x^2/x", "(x+1)^2 - x^2 - 2*x", "sin(x)^2 + cos(x)^2 + 1",
  "ln(exp(2 x))", "0*x + 5 - 2 - 3", "x^0 + x^1", "(2*x)^3", "a - b + b - a",
  "sqrt(1) + cos(0)", "-(-x)", "1/x/x", "3 (x + 2) x", "exp(ln(y))*y^-1"];
for (const t of texts) {
  const e = parse(t);
  console.log(t, "=>", String(e), "=>", String(s.run(e)), "=>", String(s.run(expand(e))));
}
const derivatives = ["x^3 - 2*x + 1", "sin(x^2)", "x*exp(x)", "ln(x)/x", "x^x",
  "sqrt(1 + x^2)", "(x + 1)*(x - 1)", "cos(sin(x))", "y^2*x"];
let mixed = 0;
for (let round = 0; round < 30; round++) for (const t of derivatives) {
  let e: Expr = parse(round ? t.replace(/(\d)/, d => String(+d + (round % 7))) : t);
  for (let k = 0; k < 3; k++) {
    const d = new Simplifier().run(e.derive("x"));
    const at = 0.5 + round / 40, h = 1e-5;
    const want = (e.value(new Env({ x: at + h, y: 2 })) - e.value(new Env({ x: at - h,
      y: 2 }))) / (2 * h), got = d.value(new Env({ x: at, y: 2 }));
    if (Math.abs(want - got) > 1e-3 * Math.max(1, Math.abs(want))) console.log("differs", t, k,
      want, got);
    mixed = (mixed * 31 + d.size + String(d).length) >>> 0;
    if (round === 0 && k === 0) console.log(t, "'", String(d));
    e = d;
    if (e.size > 400) break;
  }
}
console.log(mixed, Expr.made > 1000);
console.log(String(integrate(parse("3*x^2 + 2*x - (x + 1)*(x - 2)"), "x", s)),
  coefficients(parse("(x + 2)^5"), "x", s).join(), solve(parse("x^3 - 6*x^2 + 11*x - 6"), "x",
  -10, 10).map(v => v.toFixed(6)).join(), solve(parse("cos(x) - x"), "x", -2,
  2).map(v => v.toFixed(6)).join(), String(parse("x^2 - y*x").interval({ x: new Interval(-1,
  2), y: new Interval(0, 1) })));
console.log(plot(parse("sin(x)"), "x", 0, 6.28, 40, 7));
console.log(JSON.stringify(Object.entries(s.uses).sort()), String(parse("x^2 + y").replace("x",
  parse("y + 1"))), parse("a*b").equals(parse("a*b")), parse("x + y*z").has("z"));
for (const bad of ["", "1 +", "(x", "sin(x", "x ) ", "$", "foo(x) bar"]) try {
  console.log(bad, String(parse(bad)));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
for (const f of [() => parse("q").value(new Env({})), () => coefficients(parse("sin(x)"), "x",
  s), () => new Call("tan", Num.of(1)), () => parse("x^-1").interval({ x: new Interval(1,
  2) }), () => new Interval(2, 1)]) try {
  f();
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
