// Templates: a tokenizer, a tree, filters, blocks that are inherited, macros, loops with a state, includes, autoescape, a cache, errors with positions
export type Token = {
  kind: "text";
  value: string;
  at: number
} | {
  kind: "out";
  value: string;
  at: number
} | {
  kind: "tag";
  name: string;
  rest: string;
  at: number
};
export type Expr = {
  t: "lit";
  v: unknown
} | {
  t: "name";
  v: string
} | {
  t: "get";
  o: Expr;
  k: Expr
} | {
  t: "op";
  op: string;
  l: Expr;
  r: Expr
} | {
  t: "not";
  e: Expr
} | {
  t: "list";
  items: Expr[]
} | {
  t: "call";
  f: Expr;
  all: Expr[]
} | {
  t: "filter";
  e: Expr;
  name: string;
  all: Expr[]
} | {
  t: "test";
  c: Expr;
  a: Expr;
  b: Expr
};
export abstract class Node {
  constructor(readonly at: number) {
  }
  abstract render(c: Scope, out: Out): void;
  children(): Node[] {
    return [];
  }
}
export class TemplateError extends Error {
  constructor(message: string, readonly template: string, readonly line: number) {
    super(`${template}:${line}: ${message}`);
    this.name = "TemplateError";
  }
}
export class Safe {
  constructor(readonly text: string) {
  }
  toString() {
    return this.text;
  }
}
export class Out {
  #parts: string[] = [];
  length = 0;
  write(text: string) {
    if (text) {
      this.#parts.push(text);
      this.length += text.length;
    }
  }
  toString() {
    return this.#parts.join("");
  }
}
export class Scope {
  readonly #vars: Map<string, unknown>;
  constructor(readonly engine: Engine, vars: Record<string, unknown> | null,
    readonly up: Scope | null = null, readonly blocks: Map<string,
    Block[]> = up?.blocks ?? new Map()) {
    this.#vars = new Map(Object.entries(vars ?? {}));
  }
  get(name: string): unknown {
    for (let s: Scope | null = this; s; s = s.up) if (s.#vars.has(name)) return s.#vars.get(name);
    return this.engine.globals[name];
  }
  set(name: string, v: unknown) {
    this.#vars.set(name, v);
  }
  child(vars: Record<string, unknown> | null = null) {
    return new Scope(this.engine, vars, this);
  }
}
export class ExprParser {
  readonly #t: RegExpMatchArray[];
  #i = 0;
  constructor(readonly source: string) {
    this.#t = [...source.matchAll(/\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z_]\w*)|(==|!=|<=|>=|[-+*\/%<>()\[\]|.,?:~]))/g)];
    if (this.#t.reduce((n, m) => n + m[0].length,
      0) !== source.trimEnd().length) throw new SyntaxError("bad expression: " + source.trim());
  }
  get done() {
    return this.#i >= this.#t.length;
  }
  #is(text: string) {
    const t = this.#t[this.#i];
    return !!t && (t[5] === text || t[4] === text);
  }
  take(text: string) {
    if (this.#is(text)) {
      this.#i++;
      return true;
    }
    return false;
  }
  need(text: string) {
    if (!this.take(text)) throw new SyntaxError(`expected ${text} in ${this.source.trim()}`);
  }
  name(): string {
    const t = this.#t[this.#i++];
    if (!t?.[4]) throw new SyntaxError("expected a name in " + this.source.trim());
    return t[4];
  }
  static readonly levels = [["or"], ["and"], ["==", "!=", "<", ">", "<=", ">=", "in"], ["~"],
    ["+", "-"], ["*", "/", "%"]];
  parse(): Expr {
    const c = this.#binary(0);
    if (!this.take("?")) return c;
    const a = this.parse();
    this.need(":");
    return {
      t: "test", c, a, b: this.parse()
  };
  }
  #binary(level: number): Expr {
    if (level === ExprParser.levels.length) return this.#unary();
    let l = this.#binary(level + 1);
    for (;;) {
      const op = ExprParser.levels[level].find(o => this.#is(o));
      if (!op) return l;
      this.#i++;
      l = {
        t: "op", op, l, r: this.#binary(level + 1)
    };
    }
  }
  #unary(): Expr {
    if (this.take("not")) return {
      t: "not", e: this.#unary()
  };
    if (this.take("-")) return {
      t: "op", op: "-", l: {
        t: "lit", v: 0
    }, r: this.#unary()
  };
    return this.#postfix(this.#atom());
  }
  #all(end: string): Expr[] {
    const out: Expr[] = [];
    if (this.take(end)) return out;
    do out.push(this.parse());
    while (this.take(","));
    this.need(end);
    return out;
  }
  #atom(): Expr {
    const t = this.#t[this.#i++];
    if (!t) throw new SyntaxError("expression ends: " + this.source.trim());
    if (t[1] !== undefined) return {
      t: "lit", v: +t[1]
  };
    if (t[2] !== undefined) return {
      t: "lit", v: JSON.parse(`"${t[2]}"`)
  };
    if (t[3] !== undefined) return {
      t: "lit", v: t[3]
  };
    if (t[4] !== undefined) return t[4] === "true" || t[4] === "false" ? {
      t: "lit", v: t[4] === "true"
  } : t[4] === "none" ? {
      t: "lit", v: null
  } : {
      t: "name", v: t[4]
  };
    if (t[5] === "(") {
      const e = this.parse();
      this.need(")");
      return e;
    }
    if (t[5] === "[") return {
      t: "list", items: this.#all("]")
  };
    throw new SyntaxError("unexpected " + t[0].trim());
  }
  #postfix(e: Expr): Expr {
    for (;;) {
      if (this.take(".")) e = {
        t: "get", o: e, k: {
          t: "lit", v: this.name()
        }
    };
      else if (this.take("[")) {
        e = {
          t: "get", o: e, k: this.parse()
      };
        this.need("]");
    } else if (this.take("(")) e = {
        t: "call", f: e, all: this.#all(")")
    };
      else if (this.take("|")) {
        const name = this.name();
        e = {
          t: "filter", e, name, all: this.take("(") ? this.#all(")") : []
      };
    } else return e;
    }
  }
}
export const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v instanceof Map ||
  v instanceof Set ? v.size > 0 : !!v);
export function evaluate(e: Expr, c: Scope): any {
  switch (e.t) {
    case "lit": return e.v;
    case "name": return c.get(e.v);
    case "list": return e.items.map(x => evaluate(x, c));
    case "not": return !truthy(evaluate(e.e, c));
    case "test": return evaluate(truthy(evaluate(e.c, c)) ? e.a : e.b, c);
    case "get": {
      const o = evaluate(e.o, c), k = evaluate(e.k, c);
      if (o === null || o === undefined) return undefined;
      return o instanceof Map ? o.get(k) : Object.prototype.hasOwnProperty.call(Object(o),
        k) || typeof o[k] !== "function" ? o[k] : undefined;
    }
    case "call": {
      const f = evaluate(e.f, c);
      if (typeof f !== "function") throw new TypeError("not a function");
      return f(...e.all.map(x => evaluate(x, c)));
    }
    case "filter": {
      const f = c.engine.filters[e.name];
      if (!f) throw new ReferenceError("no filter " + e.name);
      return f(evaluate(e.e, c), ...e.all.map(x => evaluate(x, c)));
    }
    case "op": {
      if (e.op === "and") {
        const l = evaluate(e.l, c);
        return truthy(l) ? evaluate(e.r, c) : l;
      }
      if (e.op === "or") {
        const l = evaluate(e.l, c);
        return truthy(l) ? l : evaluate(e.r, c);
      }
      const l = evaluate(e.l, c), r = evaluate(e.r, c);
      switch (e.op) {
        case "==": return l === r;
        case "!=": return l !== r;
        case "<": return l < r;
        case ">": return l > r;
        case "<=": return l <= r;
        case ">=": return l >= r;
        case "in": return Array.isArray(r) ? r.includes(l) : typeof r === "string" ? r.includes(String(l)) : l in r;
        case "~": return String(l ?? "") + String(r ?? "");
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
        default: return l % r;
      }
    }
  }
}
export class TextNode extends Node {
  constructor(at: number, readonly text: string) {
    super(at);
  }
  render(_: Scope, out: Out) {
    out.write(this.text);
  }
}
export class OutNode extends Node {
  constructor(at: number, readonly e: Expr) {
    super(at);
  }
  render(c: Scope, out: Out) {
    const v = evaluate(this.e, c);
    out.write(v instanceof Safe ? v.text : v === null ||
      v === undefined ? "" : c.engine.escape(Array.isArray(v) ? v.join(", ") : String(v)));
  }
}
export class IfNode extends Node {
  constructor(at: number, readonly arms: { test: Expr | null; body: Node[] }[]) {
    super(at);
  }
  children() {
    return this.arms.flatMap(a => a.body);
  }
  render(c: Scope, out: Out) {
    for (const a of this.arms) if (!a.test || truthy(evaluate(a.test, c))) {
      for (const n of a.body) n.render(c, out);
      return;
    }
  }
}
export class ForNode extends Node {
  constructor(at: number, readonly names: string[], readonly over: Expr, readonly body: Node[],
    readonly empty: Node[]) {
    super(at);
  }
  children() {
    return [...this.body, ...this.empty];
  }
  render(c: Scope, out: Out) {
    const v = evaluate(this.over, c);
    const items: unknown[] = v === null ||
      v === undefined ? [] : typeof v === "number" ? Array.from({ length: v }, (_,
      i) => i) : typeof v[Symbol.iterator] === "function" ? [...v] : Object.entries(v);
    if (!items.length) {
      for (const n of this.empty) n.render(c, out);
      return;
    }
    items.forEach((item, i) => {
      const inner = c.child({ loop: { index: i + 1, index0: i, first: i === 0,
        last: i === items.length - 1, length: items.length,
        cycle: (...all: unknown[]) => all[i % all.length] } });
      if (this.names.length === 1) inner.set(this.names[0], item);
      else this.names.forEach((n, k) => inner.set(n, (item as unknown[])[k]));
      for (const n of this.body) n.render(inner, out);
  });
  }
}
export class Block extends Node {
  constructor(at: number, readonly name: string, readonly body: Node[]) {
    super(at);
  }
  children() {
    return this.body;
  }
  render(c: Scope, out: Out, depth = 0) {
    const chain = c.blocks.get(this.name);
    const own = chain ? chain[Math.min(depth, chain.length - 1)] : this;
    const inner = c.child();
    inner.set("parent", () => {
      if (!chain || depth + 1 >= chain.length) return new Safe("");
      const o = new Out();
      this.render(c, o, depth + 1);
      return new Safe(String(o));
  });
    for (const n of own.body) n.render(inner, out);
  }
}
export class SetNode extends Node {
  constructor(at: number, readonly name: string, readonly e: Expr) {
    super(at);
  }
  render(c: Scope, _out?: Out) {
    c.set(this.name, evaluate(this.e, c));
  }
}
export class MacroNode extends Node {
  constructor(at: number, readonly name: string,
    readonly params: { name: string; def: Expr | null }[], readonly body: Node[]) {
    super(at);
  }
  children() {
    return this.body;
  }
  render(c: Scope, _out?: Out) {
    c.set(this.name, (...all: unknown[]) => {
      const inner = c.child();
      this.params.forEach((p, i) => inner.set(p.name, all[i] ?? (p.def ? evaluate(p.def,
        c) : undefined)));
      const out = new Out();
      for (const n of this.body) n.render(inner, out);
      return new Safe(String(out));
  });
  }
}
export class IncludeNode extends Node {
  constructor(at: number, readonly e: Expr) {
    super(at);
  }
  render(c: Scope, out: Out) {
    out.write(c.engine.renderIn(String(evaluate(this.e, c)), c));
  }
}
export interface Template {
  name: string;
  nodes: Node[];
  extends: string | null;
  source: string
}
export class Engine {
  readonly #cache = new Map<string, Template>();
  parsed = 0;
  rendered = 0;
  readonly globals: Record<string, unknown> = {
    range: (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
};
  readonly filters: Record<string, (v: any, ...all: any[]) => unknown> = {
    upper: v => String(v).toUpperCase(), lower: v => String(v).toLowerCase(),
      title: v => String(v).replace(/\b\w/g, c => c.toUpperCase()),
      length: v => v?.length ?? 0, join: (v, by = ", ") => v.join(by), default: (v,
      d) => v ?? d, safe: v => new Safe(String(v)), round: (v, n = 0) => Number(v).toFixed(n),
      sort: (v, k) => [...v].sort((a: any, b: any) => {
      const x = k ? a[k] : a, y = k ? b[k] : b;
      return x < y ? -1 : x > y ? 1 : 0;
  }), map: (v, k) => v.map((x: any) => x[k]), first: v => v[0], replace: (v, a,
    b) => String(v).split(a).join(b), truncate: (v,
    n = 10) => (String(v).length > n ? String(v).slice(0, n - 1) + "…" : v),
    sum: v => v.reduce((a: number, b: number) => a + b, 0), reverse: v => [...v].reverse()
};
  constructor(readonly sources: Record<string, string>) {
  }
  escape(s: string) {
    return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  }
  static tokens(source: string): Token[] {
    const out: Token[] = [];
    const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?\s*(\w+)([\s\S]*?)-?%\}|\{#[\s\S]*?#\}/g;
    let last = 0, m: RegExpExecArray | null;
    let trim = false;
    const text = (to: number, next: string) => {
      let t = source.slice(last, to);
      if (trim) t = t.replace(/^\s+/, "");
      if (/^\{[{%]-/.test(next)) t = t.replace(/\s+$/, "");
      if (t) out.push({ kind: "text", value: t, at: last });
  };
    while ((m = re.exec(source))) {
      text(m.index, m[0]);
      if (m[1] !== undefined) out.push({ kind: "out", value: m[1], at: m.index });
      else if (m[2]) out.push({ kind: "tag", name: m[2], rest: m[3], at: m.index });
      last = re.lastIndex;
      trim = /-[}%]\}$/.test(m[0]);
    }
    text(source.length, "");
    return out;
  }
  load(name: string): Template {
    const kept = this.#cache.get(name);
    if (kept) return kept;
    const source = this.sources[name];
    if (source === undefined) throw new TemplateError("no such template", name, 0);
    this.parsed++;
    const tokens = Engine.tokens(source);
    let i = 0, parent: string | null = null;
    const fail = (message: string, at: number): never => {
      throw new TemplateError(message, name, source.slice(0, at).split("\n").length);
  };
    const expr = (text: string, at: number): Expr => {
      try {
        const p = new ExprParser(text), e = p.parse();
        if (!p.done) throw new SyntaxError("more in " + text.trim());
        return e;
    } catch (e) {
        return fail((e as Error).message, at);
      }
  };
    const body = (...ends: string[]): {
      nodes: Node[];
      end: Token & {
        kind: "tag"
      }
  } => {
      const nodes: Node[] = [];
      for (;;) {
        const t = tokens[i++];
        if (!t) {
          if (ends.length) fail("expected " + ends.join(" or "), source.length);
          return {
            nodes, end: null as any
        };
        }
        if (t.kind === "text") {
          nodes.push(new TextNode(t.at, t.value));
          continue;
        }
        if (t.kind === "out") {
          nodes.push(new OutNode(t.at, expr(t.value, t.at)));
          continue;
        }
        if (ends.includes(t.name)) return {
          nodes, end: t
      };
        switch (t.name) {
          case "if": {
            const arms: {
              test: Expr | null;
              body: Node[]
          }[] = [];
            let test: Expr | null = expr(t.rest, t.at);
            for (;;) {
              const b = body("elif", "else", "endif");
              arms.push({ test, body: b.nodes });
              if (b.end.name === "endif") break;
              test = b.end.name === "elif" ? expr(b.end.rest, b.end.at) : null;
            }
            nodes.push(new IfNode(t.at, arms));
            break;
          }
          case "for": {
            const m = /^\s*([\w\s,]+?)\s+in\s+([\s\S]+)$/.exec(t.rest) ?? fail("bad for", t.at);
            const b = body("else", "endfor");
            const empty = b.end.name === "else" ? body("endfor").nodes : [];
            nodes.push(new ForNode(t.at, m[1].split(",").map(s => s.trim()), expr(m[2], t.at),
              b.nodes, empty));
            break;
          }
          case "block": nodes.push(new Block(t.at, t.rest.trim(), body("endblock").nodes));
          break;
          case "set": {
            const m = /^\s*(\w+)\s*=([\s\S]+)$/.exec(t.rest) ?? fail("bad set", t.at);
            nodes.push(new SetNode(t.at, m[1], expr(m[2], t.at)));
            break;
          }
          case "macro": {
            const m = /^\s*(\w+)\((.*)\)\s*$/.exec(t.rest) ?? fail("bad macro", t.at);
            nodes.push(new MacroNode(t.at, m[1],
              m[2].split(",").filter(s => s.trim()).map(p => {
              const [n, d] = p.split("=");
              return {
                name: n.trim(), def: d === undefined ? null : expr(d, t.at)
            };
          }), body("endmacro").nodes));
            break;
          }
          case "include": nodes.push(new IncludeNode(t.at, expr(t.rest, t.at)));
          break;
          case "extends": parent = String((expr(t.rest, t.at) as { v: unknown }).v);
          break;
          default: fail("unknown tag " + t.name, t.at);
        }
      }
  };
    const template: Template = {
      name, nodes: body().nodes, extends: parent, source
  };
    this.#cache.set(name, template);
    return template;
  }
  static *blocks(nodes: Node[]): Generator<Block> {
    for (const n of nodes) {
      if (n instanceof Block) yield n;
      yield* Engine.blocks(n.children());
    }
  }
  renderIn(name: string, c: Scope): string {
    this.rendered++;
    let t = this.load(name);
    const chain: Template[] = [t];
    while (t.extends) {
      t = this.load(t.extends);
      if (chain.includes(t)) throw new TemplateError("extends itself", t.name, 1);
      chain.push(t);
    }
    const scope = chain.length > 1 ? new Scope(this, null, c, new Map()) : c.child();
    if (chain.length > 1) for (const x of chain) for (const b of Engine.blocks(x.nodes)) {
      const list = scope.blocks.get(b.name);
      if (list) list.push(b);
      else scope.blocks.set(b.name, [b]);
    }
    const out = new Out();
    if (chain.length > 1) for (const x of chain.slice(0,
      -1)) for (const n of x.nodes) if (n instanceof MacroNode ||
      n instanceof SetNode) n.render(scope, out);
    for (const n of t.nodes) n.render(scope, out);
    return String(out);
  }
  render(name: string, vars: Record<string, unknown>): string {
    return this.renderIn(name, new Scope(this, vars));
  }
}
