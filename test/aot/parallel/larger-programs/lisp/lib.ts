// A small Lisp: reader, printer, environments, macros, tail calls, a library written in itself
export type Value = number | string | boolean | null | Sym | Pair | Native | Lambda | Value[];
export class Sym {
  static #all = new Map<string, Sym>();
  private constructor(readonly name: string) {
  }
  static of(name: string): Sym {
    let s = Sym.#all.get(name);
    if (!s) Sym.#all.set(name, (s = new Sym(name)));
    return s;
  }
  toString() {
    return this.name;
  }
}
export class Pair {
  constructor(public car: Value, public cdr: Value) {
  }
  *[Symbol.iterator](): Generator<Value> {
    let at: Value = this;
    while (at instanceof Pair) {
      yield at.car;
      at = at.cdr;
    }
    if (at !== null) throw new LispError("improper list");
  }
  static from(items: Value[], tail: Value = null): Value {
    let out: Value = tail;
    for (let i = items.length - 1; i >= 0; i--) out = new Pair(items[i], out);
    return out;
  }
}
export class LispError extends Error {
  constructor(message: string, readonly at?: Value) {
    super(at === undefined ? message : message + ": " + print(at));
    this.name = "LispError";
  }
}
export class Native {
  constructor(readonly name: string, readonly arity: [number, number],
    readonly call: (...all: any[]) => Value) {
  }
}
export class Lambda {
  constructor(readonly params: Sym[], readonly rest: Sym | null, readonly body: Value[],
    readonly env: Env, readonly macro = false, public name = "lambda") {
  }
}
export class Env {
  readonly #vars = new Map<Sym, Value>();
  static lookups = 0;
  constructor(readonly up: Env | null = null) {
  }
  define(name: Sym, value: Value) {
    this.#vars.set(name, value);
    if (value instanceof Lambda && value.name === "lambda") value.name = name.name;
    return value;
  }
  find(name: Sym): Env {
    Env.lookups++;
    for (let e: Env | null = this; e; e = e.up) if (e.#vars.has(name)) return e;
    throw new LispError("unbound", name);
  }
  get(name: Sym): Value {
    return this.find(name).#vars.get(name)!;
  }
  set(name: Sym, value: Value) {
    this.find(name).#vars.set(name, value);
  }
}
export class Reader {
  #tokens: {
    text: string;
    line: number
}[] = [];
  #i = 0;
  constructor(source: string) {
    const re = /\s*(;[^\n]*|"(?:[^"\\]|\\.)*"|[()'`]|,@?|[^\s()'`",;]+)/gy;
    let m: RegExpExecArray | null, line = 1;
    while ((m = re.exec(source))) {
      line += m[0].split("\n").length - 1;
      if (m[1][0] !== ";") this.#tokens.push({ text: m[1], line });
    }
  }
  get done() {
    return this.#i >= this.#tokens.length;
  }
  read(): Value {
    const t = this.#tokens[this.#i++];
    if (!t) throw new LispError("unexpected end");
    switch (t.text) {
      case "(": {
        const items: Value[] = [];
        let tail: Value = null;
        for (;;) {
          const n = this.#tokens[this.#i];
          if (!n) throw new LispError("open list from line " + t.line);
          if (n.text === ")") {
            this.#i++;
            return Pair.from(items, tail);
          }
          if (n.text === ".") {
            this.#i++;
            tail = this.read();
        } else items.push(this.read());
        }
      }
      case ")": throw new LispError("unexpected ) in line " + t.line);
      case "'": return Pair.from([Sym.of("quote"), this.read()]);
      case "`": return Pair.from([Sym.of("quasiquote"), this.read()]);
      case ",": return Pair.from([Sym.of("unquote"), this.read()]);
      case ",@": return Pair.from([Sym.of("splice"), this.read()]);
    }
    if (t.text[0] === '"') return JSON.parse(t.text) as string;
    if (t.text === "#t" || t.text === "#f") return t.text === "#t";
    if (t.text === "nil") return null;
    const n = Number(t.text);
    return Number.isNaN(n) ? Sym.of(t.text) : n;
  }
}
export function print(v: Value): string {
  if (v === null) return "nil";
  if (v === true) return "#t";
  if (v === false) return "#f";
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Sym) return v.name;
  if (v instanceof Native) return `<native ${v.name}>`;
  if (v instanceof Lambda) return `<${v.macro ? "macro" : "lambda"} ${v.name}>`;
  if (Array.isArray(v)) return "[" + v.map(print).join(" ") + "]";
  if (v instanceof Pair) {
    let out = "(" + print(v.car), at: Value = v.cdr;
    while (at instanceof Pair) {
      out += " " + print(at.car);
      at = at.cdr;
    }
    return out + (at === null ? ")" : " . " + print(at) + ")");
  }
  return String(v);
}
export namespace Special {
  export const names = ["quote", "quasiquote", "if", "define", "set!", "lambda", "let",
    "begin", "and", "or", "cond", "defmacro", "while"].map(Sym.of);
  export const is = new Set<Value>(names);
}
export class Machine {
  readonly globals = new Env();
  steps = 0;
  out: string[] = [];
  constructor() {
    for (const [name, low, high, call] of natives(this)) this.globals.define(Sym.of(name),
      new Native(name, [low, high], call));
  }
  bind(f: Lambda, all: Value[]): Env {
    if (all.length < f.params.length || (!f.rest &&
      all.length > f.params.length)) throw new LispError(`${f.name} wants ${f.params.length}${f.rest ? " or more" : ""}, got ${all.length}`);
    const env = new Env(f.env);
    f.params.forEach((p, i) => env.define(p, all[i]));
    if (f.rest) env.define(f.rest, Pair.from(all.slice(f.params.length)));
    return env;
  }
  apply(f: Value, all: Value[]): Value {
    if (f instanceof Native) {
      if (all.length < f.arity[0] ||
        all.length > f.arity[1]) throw new LispError(f.name + " got " + all.length);
      return f.call(...all);
    }
    if (f instanceof Lambda) return this.body(f.body, this.bind(f, all));
    throw new LispError("not a function", f);
  }
  body(body: Value[], env: Env): Value {
    let v: Value = null;
    for (const e of body) v = this.eval(e, env);
    return v;
  }
  quasi(v: Value, env: Env): Value {
    if (!(v instanceof Pair)) return v;
    if (v.car === Sym.of("unquote")) return this.eval((v.cdr as Pair).car, env);
    const out: Value[] = [];
    for (const item of v) if (item instanceof Pair && item.car === Sym.of("splice")) {
      const list = this.eval((item.cdr as Pair).car, env);
      if (list !== null) out.push(...(list as Pair));
  } else out.push(this.quasi(item, env));
    return Pair.from(out);
  }
  lambda(params: Value, body: Value[], env: Env, macro = false) {
    const names: Sym[] = [];
    let at = params;
    while (at instanceof Pair) {
      names.push(at.car as Sym);
      at = at.cdr;
    }
    return new Lambda(names, at as Sym | null, body, env, macro);
  }
  eval(x: Value, env: Env): Value {
    for (;;) {
      if (++this.steps > 5e7) throw new LispError("too many steps");
      if (x instanceof Sym) return env.get(x);
      if (!(x instanceof Pair)) return x;
      const head = x.car;
      if (Special.is.has(head)) {
        const [a, ...more] = x.cdr instanceof Pair ? [...x.cdr] : [];
        switch ((head as Sym).name) {
          case "quote": return a;
          case "quasiquote": return this.quasi(a, env);
          case "if": {
            const c = this.eval(a, env);
            x = c !== false && c !== null ? more[0] : more[1] ?? null;
            continue;
          }
          case "define": if (a instanceof Pair) return env.define(a.car as Sym,
            this.lambda(a.cdr, more, env));
          return env.define(a as Sym, this.eval(more[0], env));
          case "set!": {
            const v = this.eval(more[0], env);
            env.set(a as Sym, v);
            return v;
          }
          case "lambda": return this.lambda(a, more, env);
          case "defmacro": return env.define((a as Pair).car as Sym,
            this.lambda((a as Pair).cdr, more, env, true));
          case "let": {
            const inner = new Env(env);
            if (a !== null) for (const b of a as Pair) inner.define((b as Pair).car as Sym,
              this.eval(((b as Pair).cdr as Pair).car, env));
            for (const e of more.slice(0, -1)) this.eval(e, inner);
            x = more[more.length - 1];
            env = inner;
            continue;
          }
          case "begin": {
            const all = a === undefined ? [] : [a, ...more];
            for (const e of all.slice(0, -1)) this.eval(e, env);
            x = all[all.length - 1] ?? null;
            continue;
          }
          case "and": {
            let v: Value = true;
            for (const e of a === undefined ? [] : [a, ...more]) if ((v = this.eval(e,
              env)) === false || v === null) break;
            return v;
          }
          case "or": {
            let v: Value = false;
            for (const e of a === undefined ? [] : [a, ...more]) if ((v = this.eval(e,
              env)) !== false && v !== null) break;
            return v;
          }
          case "cond": {
            let hit = false;
            for (const c of [a, ...more]) {
              const [test, ...then] = [...(c as Pair)];
              if (test === Sym.of("else") || ![false, null].includes(this.eval(test,
                env) as any)) {
                for (const e of then.slice(0, -1)) this.eval(e, env);
                x = then[then.length - 1] ?? null;
                hit = true;
                break;
              }
            }
            if (!hit) return null;
            continue;
          }
          case "while": {
            while (![false, null].includes(this.eval(a,
              env) as any)) for (const e of more) this.eval(e, env);
            return null;
          }
        }
      }
      const f = this.eval(head, env);
      const given: Value[] = x.cdr instanceof Pair ? [...x.cdr] : [];
      if (f instanceof Lambda && f.macro) {
        x = this.body(f.body, this.bind(f, given));
        continue;
      }
      const all = given.map(e => this.eval(e, env));
      if (f instanceof Lambda) {
        env = this.bind(f, all);
        for (let i = 0; i < f.body.length - 1; i++) this.eval(f.body[i], env);
        x = f.body[f.body.length - 1] ?? null;
        continue;
      }
      return this.apply(f, all);
    }
  }
  run(source: string): Value {
    const reader = new Reader(source);
    let v: Value = null;
    while (!reader.done) v = this.eval(reader.read(), this.globals);
    return v;
  }
}
export function natives(m: Machine): [string, number, number, (...all: any[]) => Value][] {
  const num = (v: Value): number => {
    if (typeof v !== "number") throw new LispError("not a number", v);
    return v;
};
  const fold = (start: number, f: (a: number,
    b: number) => number) => (...all: Value[]) => all.reduce<number>((a, b) => f(a, num(b)),
    start);
  const chain = (f: (a: number, b: number) => boolean) => (...all: Value[]) => all.every((v,
    i) => i === 0 || f(num(all[i - 1]), num(v)));
  return [["+", 0, Infinity, fold(0, (a, b) => a + b)], ["*", 0, Infinity, fold(1, (a,
    b) => a * b)], ["-", 1, Infinity, (a, ...r) => (r.length ? r.reduce((x: number,
    y: Value) => x - num(y), num(a)) : -num(a))], ["/", 2, 2, (a, b) => num(a) / num(b)],
    ["mod", 2, 2, (a, b) => num(a) % num(b)], ["floor", 1, 1, a => Math.floor(num(a))], ["<",
    1, Infinity, chain((a, b) => a < b)], [">", 1, Infinity, chain((a, b) => a > b)], ["<=", 1,
    Infinity, chain((a, b) => a <= b)], ["=", 1, Infinity, chain((a, b) => a === b)], ["eq?",
    2, 2, (a, b) => a === b], ["cons", 2, 2, (a, b) => new Pair(a, b)], ["car", 1, 1, p => {
    if (!(p instanceof Pair)) throw new LispError("car of", p);
    return p.car;
}], ["cdr", 1, 1, p => {
    if (!(p instanceof Pair)) throw new LispError("cdr of", p);
    return p.cdr;
}], ["set-car!", 2, 2, (p, v) => ((p as Pair).car = v)], ["list", 0, Infinity,
  (...all) => Pair.from(all)], ["null?", 1, 1, v => v === null], ["pair?", 1, 1,
  v => v instanceof Pair], ["not", 1, 1, v => v === false || v === null], ["apply", 2, 2, (f,
  l) => m.apply(f, l === null ? [] : [...(l as Pair)])], ["vector", 0, Infinity,
  (...all) => all], ["make-vector", 2, 2, (n, v) => new Array(n).fill(v)], ["ref", 2, 2, (v,
  i) => {
    const x = (v as Value[])[i as number];
    if (x === undefined) throw new LispError("out of range", i);
    return x;
}], ["put!", 3, 3, (v, i, x) => ((v as Value[])[i as number] = x)], ["size", 1, 1,
  v => (v as Value[] | string).length], ["text", 0, Infinity,
  (...all) => all.map(v => (typeof v === "string" ? v : print(v))).join("")], ["print", 0,
  Infinity, (...all) => {
    m.out.push(all.map(v => (typeof v === "string" ? v : print(v))).join(" "));
    return null;
}], ["error", 1, 1, t => {
    throw new LispError(String(t));
}], ["try", 2, 2, (f, g) => {
    try {
      return m.apply(f, []);
  } catch (e) {
      if (!(e instanceof LispError)) throw e;
      return m.apply(g, [e.message]);
    }
}]];
}
export const library = `(defmacro (when c . body) \`(if ,c (begin ,@body) nil)) (defmacro (for v from to . body) \`(let ((,v ,from)) (while (< ,v ,to) ,@body (set! ,v (+ ,v 1)))))
(define (map f l) (if (null? l) nil (cons (f (car l)) (map f (cdr l))))) (define (filter f l) (cond ((null? l) nil) ((f (car l)) (cons (car l) (filter f (cdr l)))) (else (filter f (cdr l))))) (define (fold f a l) (if (null? l) a (fold f (f a (car l)) (cdr l)))) (define (range a b) (let ((out nil) (i (- b 1))) (while (<= a i) (set! out (cons i out)) (set! i (- i 1))) out)) (define (reverse l) (fold (lambda (a x) (cons x a)) nil l)) (define (append a b) (fold (lambda (r x) (cons x r)) b (reverse a))) (define (length l) (fold (lambda (n x) (+ n 1)) 0 l))
(define (sort l) (if (null? l) nil (let ((p (car l))) (append (sort (filter (lambda (x) (< x p)) (cdr l))) (cons p (sort (filter (lambda (x) (not (< x p))) (cdr l)))))))) (define (compose . fs) (lambda (x) (fold (lambda (v f) (f v)) x fs)))`;
