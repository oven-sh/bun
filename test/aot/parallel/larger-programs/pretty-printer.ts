// A tokenizer, a parser and a pretty printer for a small language, with comments kept, scopes resolved, constants folded and a minifier
enum TokenKind {
  Number, String, Name, Keyword, Punct, End
}
interface Position {
  line: number;
  column: number
}
interface Token {
  kind: TokenKind;
  text: string;
  at: Position;
  before: string[]
}
const keywords = new Set(["let", "fn", "if", "else", "while", "for", "in", "return", "true",
  "false", "nil", "break", "match"]);
class LexError extends SyntaxError {
  constructor(message: string, readonly at: Position) {
    super(`${at.line}:${at.column} ${message}`);
    this.name = "LexError";
  }
}
class Lexer implements Iterable<Token> {
  #i = 0;
  #line = 1;
  #start = 0;
  count = 0;
  constructor(readonly source: string) {
  }
  #at(): Position {
    return {
      line: this.#line, column: this.#i - this.#start + 1
  };
  }
  *[Symbol.iterator](): Generator<Token> {
    let before: string[] = [];
    const s = this.source;
    while (this.#i < s.length) {
      const c = s[this.#i];
      if (c === "\n") {
        this.#i++;
        this.#line++;
        this.#start = this.#i;
        continue;
      }
      if (c === " " || c === "\t" || c === "\r") {
        this.#i++;
        continue;
      }
      if (c === "#") {
        const end = s.indexOf("\n", this.#i);
        const stop = end < 0 ? s.length : end;
        before.push(s.slice(this.#i + 1, stop).trim());
        this.#i = stop;
        continue;
      }
      const at = this.#at(), from = this.#i;
      let kind: TokenKind;
      if (c >= "0" && c <= "9") {
        kind = TokenKind.Number;
        while (/[0-9._eE]/.test(s[this.#i] ?? "") && !(s[this.#i] === "." &&
          s[this.#i + 1] === ".")) this.#i++;
    } else if (/[A-Za-z_]/.test(c)) {
        while (/\w/.test(s[this.#i] ?? "")) this.#i++;
        kind = keywords.has(s.slice(from, this.#i)) ? TokenKind.Keyword : TokenKind.Name;
    } else if (c === '"') {
        kind = TokenKind.String;
        this.#i++;
        while (s[this.#i] !== '"') {
          if (this.#i >= s.length || s[this.#i] === "\n") throw new LexError("open string", at);
          this.#i += s[this.#i] === "\\" ? 2 : 1;
        }
        this.#i++;
    } else {
        const p = ["..", "=>", "==", "!=", "<=", ">=", "&&", "||",
          "|>"].find(x => s.startsWith(x,
          this.#i)) ?? ("+-*/%<>=!(){}[],.:;|".includes(c) ? c : null);
        if (!p) throw new LexError("bad character " + JSON.stringify(c), at);
        kind = TokenKind.Punct;
        this.#i += p.length;
      }
      this.count++;
      yield {
        kind, text: s.slice(from, this.#i), at, before
    };
      before = [];
    }
    yield {
      kind: TokenKind.End, text: "", at: this.#at(), before
  };
  }
}
type Expr = {
  t: "num";
  v: number
} | {
  t: "str";
  v: string
} | {
  t: "bool";
  v: boolean
} | {
  t: "nil"
} | {
  t: "name";
  v: string
} | {
  t: "un";
  op: string;
  e: Expr
} | {
  t: "bin";
  op: string;
  l: Expr;
  r: Expr
} | {
  t: "call";
  f: Expr;
  all: Expr[]
} | {
  t: "index";
  o: Expr;
  k: Expr
} | {
  t: "dot";
  o: Expr;
  name: string
} | {
  t: "list";
  items: Expr[]
} | {
  t: "record";
  fields: [string, Expr][]
} | {
  t: "fn";
  params: string[];
  body: Stmt[] | Expr
} | {
  t: "if";
  c: Expr;
  a: Expr;
  b: Expr
} | {
  t: "match";
  e: Expr;
  arms: {
    pattern: Expr | null;
    to: Expr
}[]
};
type Stmt = ({ s: "let"; name: string; e: Expr } | { s: "set"; target: Expr; e: Expr } | { s: "expr"; e: Expr } | { s: "if"; c: Expr; a: Stmt[]; b: Stmt[] | null } | { s: "while"; c: Expr; body: Stmt[] } | { s: "for"; name: string; over: Expr; body: Stmt[] } | { s: "return"; e: Expr | null } | { s: "break" } | { s: "fn"; name: string; params: string[]; body: Stmt[] }) & {
  notes?: string[]
};
const precedence: Record<string, number> = {
  "|>": 1, "||": 2, "&&": 3, "==": 4, "!=": 4, "<": 5, ">": 5, "<=": 5, ">=": 5, "..": 6,
    "+": 7, "-": 7, "*": 8, "/": 8, "%": 8
};
class Parser {
  readonly #tokens: Token[];
  #i = 0;
  constructor(source: string) {
    this.#tokens = [...new Lexer(source)];
  }
  get #t() {
    return this.#tokens[this.#i];
  }
  #is(text: string) {
    return this.#t.text === text && this.#t.kind !== TokenKind.String;
  }
  #take(text: string) {
    if (this.#is(text)) {
      this.#i++;
      return true;
    }
    return false;
  }
  #need(text: string) {
    if (!this.#take(text)) throw new LexError(`expected ${text}, got ${this.#t.text || "the end"}`,
      this.#t.at);
  }
  #name() {
    const t = this.#tokens[this.#i++];
    if (t.kind !== TokenKind.Name) throw new LexError("expected a name, got " + t.text, t.at);
    return t.text;
  }
  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.#t.kind !== TokenKind.End) out.push(this.statement());
    return out;
  }
  #block(): Stmt[] {
    this.#need("{");
    const out: Stmt[] = [];
    while (!this.#take("}")) {
      if (this.#t.kind === TokenKind.End) throw new LexError("open block", this.#t.at);
      out.push(this.statement());
    }
    return out;
  }
  #params() {
    const out: string[] = [];
    this.#need("(");
    while (!this.#take(")")) {
      out.push(this.#name());
      if (!this.#is(")")) this.#need(",");
    }
    return out;
  }
  statement(): Stmt {
    const notes = this.#t.before.length ? this.#t.before : undefined;
    const s = this.#statement();
    if (notes) s.notes = notes;
    return s;
  }
  #statement(): Stmt {
    if (this.#take("let")) {
      const name = this.#name();
      this.#need("=");
      const e = this.expression();
      this.#take(";");
      return {
        s: "let", name, e
    };
    }
    if (this.#is("fn") && this.#tokens[this.#i + 1].kind === TokenKind.Name) {
      this.#i++;
      const name = this.#name();
      return {
        s: "fn", name, params: this.#params(), body: this.#block()
    };
    }
    if (this.#take("if")) return this.#if();
    if (this.#take("while")) {
      const c = this.expression();
      return {
        s: "while", c, body: this.#block()
    };
    }
    if (this.#take("for")) {
      const name = this.#name();
      this.#need("in");
      const over = this.expression();
      return {
        s: "for", name, over, body: this.#block()
    };
    }
    if (this.#take("return")) {
      const e = this.#is(";") || this.#is("}") ? null : this.expression();
      this.#take(";");
      return {
        s: "return", e
    };
    }
    if (this.#take("break")) {
      this.#take(";");
      return {
        s: "break"
    };
    }
    const e = this.expression();
    if (this.#take("=")) {
      if (e.t !== "name" && e.t !== "index" &&
        e.t !== "dot") throw new LexError("cannot assign", this.#t.at);
      const v = this.expression();
      this.#take(";");
      return {
        s: "set", target: e, e: v
    };
    }
    this.#take(";");
    return {
      s: "expr", e
  };
  }
  #if(): Stmt {
    const c = this.expression(), a = this.#block();
    let b: Stmt[] | null = null;
    if (this.#take("else")) b = this.#take("if") ? [this.#if()] : this.#block();
    return {
      s: "if", c, a, b
  };
  }
  expression(min = 0): Expr {
    let l = this.#unary();
    for (;;) {
      const p = this.#t.kind === TokenKind.Punct ? precedence[this.#t.text] : undefined;
      if (p === undefined || p <= min) return l;
      const op = this.#tokens[this.#i++].text;
      l = {
        t: "bin", op, l, r: this.expression(p)
    };
    }
  }
  #unary(): Expr {
    if (this.#is("-") || this.#is("!")) {
      const op = this.#tokens[this.#i++].text;
      return {
        t: "un", op, e: this.#unary()
    };
    }
    let e = this.#atom();
    for (;;) {
      if (this.#take("(")) {
        const all: Expr[] = [];
        while (!this.#take(")")) {
          all.push(this.expression());
          if (!this.#is(")")) this.#need(",");
        }
        e = {
          t: "call", f: e, all
      };
    } else if (this.#take("[")) {
        const k = this.expression();
        this.#need("]");
        e = {
          t: "index", o: e, k
      };
    } else if (this.#take(".")) e = {
        t: "dot", o: e, name: this.#name()
    };
      else return e;
    }
  }
  #atom(): Expr {
    const t = this.#tokens[this.#i++];
    switch (t.kind) {
      case TokenKind.Number: {
        const v = Number(t.text.replaceAll("_", ""));
        if (Number.isNaN(v)) throw new LexError("bad number " + t.text, t.at);
        return {
          t: "num", v
      };
      }
      case TokenKind.String: return {
        t: "str", v: JSON.parse(t.text)
    };
      case TokenKind.Name: return {
        t: "name", v: t.text
    };
      case TokenKind.Keyword: switch (t.text) {
        case "true": case "false": return {
          t: "bool", v: t.text === "true"
      };
        case "nil": return {
          t: "nil"
      };
        case "fn": {
          const params = this.#params();
          return {
            t: "fn", params, body: this.#take("=>") ? this.expression() : this.#block()
        };
        }
        case "if": {
          const c = this.expression();
          this.#need("{");
          const a = this.expression();
          this.#need("}");
          this.#need("else");
          this.#need("{");
          const b = this.expression();
          this.#need("}");
          return {
            t: "if", c, a, b
        };
        }
        case "match": {
          const e = this.expression();
          this.#need("{");
          const arms: {
            pattern: Expr | null;
            to: Expr
        }[] = [];
          while (!this.#take("}")) {
            const pattern = this.#take("else") ? null : this.expression();
            this.#need("=>");
            arms.push({ pattern, to: this.expression() });
            this.#take(",");
          }
          return {
            t: "match", e, arms
        };
        }
      }
      break;
      case TokenKind.Punct: if (t.text === "(") {
        const e = this.expression();
        this.#need(")");
        return e;
      }
      if (t.text === "[") {
        const items: Expr[] = [];
        while (!this.#take("]")) {
          items.push(this.expression());
          if (!this.#is("]")) this.#need(",");
        }
        return {
          t: "list", items
      };
      }
      if (t.text === "{") {
        const fields: [string, Expr][] = [];
        while (!this.#take("}")) {
          const n = this.#name();
          this.#need(":");
          fields.push([n, this.expression()]);
          if (!this.#is("}")) this.#need(",");
        }
        return {
          t: "record", fields
      };
      }
    }
    throw new LexError("unexpected " + (t.text || "end"), t.at);
  }
}
class Printer {
  #out: string[] = [];
  #depth = 0;
  constructor(readonly width = 60, readonly tight = false) {
  }
  print(program: Stmt[]): string {
    this.#out = [];
    for (const s of program) this.statement(s);
    return this.#out.join(this.tight ? "" : "\n") + (this.tight ? "" : "\n");
  }
  #line(text: string) {
    this.#out.push(this.tight ? text : "  ".repeat(this.#depth) + text);
  }
  #body(head: string, body: Stmt[], tail = "}") {
    this.#line(head + (this.tight ? "{" : " {"));
    this.#depth++;
    for (const s of body) this.statement(s);
    this.#depth--;
    if (tail) this.#line(tail);
  }
  get #sp() {
    return this.tight ? "" : " ";
  }
  statement(s: Stmt): void {
    if (!this.tight) for (const n of s.notes ?? []) this.#line("# " + n);
    const end = this.tight ? ";" : ";";
    switch (s.s) {
      case "let": this.#line(`let ${s.name}${this.#sp}=${this.#sp}${this.expr(s.e)}${end}`);
      break;
      case "set": this.#line(`${this.expr(s.target)}${this.#sp}=${this.#sp}${this.expr(s.e)}${end}`);
      break;
      case "expr": this.#line(this.expr(s.e) + end);
      break;
      case "return": this.#line(s.e ? `return ${this.expr(s.e)}${end}` : "return" + end);
      break;
      case "break": this.#line("break" + end);
      break;
      case "fn": this.#body(`fn ${s.name}(${s.params.join("," + this.#sp)})`, s.body);
      break;
      case "while": this.#body("while " + this.expr(s.c), s.body);
      break;
      case "for": this.#body(`for ${s.name} in ${this.expr(s.over)}`, s.body);
      break;
      case "if": {
        let at: Stmt & {
          s: "if"
      } = s, head = "if ";
        for (;;) {
          this.#body(head + this.expr(at.c), at.a, at.b ? "" : "}");
          if (!at.b) break;
          if (at.b.length === 1 && at.b[0].s === "if") {
            head = this.tight ? "}else if " : "} else if ";
            at = at.b[0] as Stmt & {
              s: "if"
          };
            continue;
          }
          this.#body(this.tight ? "}else" : "} else", at.b);
          break;
        }
      }
    }
  }
  #list(open: string, items: string[], close: string): string {
    const flat = open + items.join("," + this.#sp) + close;
    if (this.tight || flat.length + this.#depth * 2 <= this.width) return flat;
    const pad = "  ".repeat(this.#depth + 1);
    return open + "\n" + items.map(i => pad + i.replaceAll("\n",
      "\n  ")).join(",\n") + "\n" + "  ".repeat(this.#depth) + close;
  }
  expr(e: Expr, up = 0): string {
    const wrap = (p: number, t: string) => (p < up ? `(${t})` : t);
    switch (e.t) {
      case "num": return String(e.v);
      case "str": return JSON.stringify(e.v);
      case "bool": return String(e.v);
      case "nil": return "nil";
      case "name": return e.v;
      case "un": return wrap(9, e.op + this.expr(e.e, 9));
      case "bin": {
        const p = precedence[e.op];
        const gap = this.tight && !/\w/.test(e.op) ? "" : " ";
        return wrap(p, this.expr(e.l, p) + gap + e.op + gap + this.expr(e.r, p + 1));
      }
      case "call": return this.#list(this.expr(e.f, 10) + "(", e.all.map(a => this.expr(a)),
        ")");
      case "index": return `${this.expr(e.o, 10)}[${this.expr(e.k)}]`;
      case "dot": return `${this.expr(e.o, 10)}.${e.name}`;
      case "list": return this.#list("[", e.items.map(i => this.expr(i)), "]");
      case "record": return this.#list("{" + this.#sp, e.fields.map(([n,
        v]) => `${n}:${this.#sp}${this.expr(v)}`), this.#sp + "}");
      case "fn": {
        const head = `fn(${e.params.join("," + this.#sp)})`;
        if (!Array.isArray(e.body)) return wrap(0,
          `${head}${this.#sp}=>${this.#sp}${this.expr(e.body)}`);
        const inner = new Printer(this.width, this.tight);
        inner.#depth = this.#depth + 1;
        for (const s of e.body) inner.statement(s);
        return this.tight ? `${head}{${inner.#out.join("")}}` : `${head} {\n${inner.#out.join("\n")}\n${"  ".repeat(this.#depth)}}`;
      }
      case "if": return wrap(0,
        `if ${this.expr(e.c)}${this.#sp}{${this.#sp}${this.expr(e.a)}${this.#sp}}${this.#sp}else${this.#sp}{${this.#sp}${this.expr(e.b)}${this.#sp}}`);
      case "match": return this.#list(`match ${this.expr(e.e)}${this.#sp}{${this.#sp}`,
        e.arms.map(a => `${a.pattern ? this.expr(a.pattern) : "else"}${this.#sp}=>${this.#sp}${this.expr(a.to)}`),
        this.#sp + "}");
    }
  }
}
class Scopes {
  readonly free = new Set<string>();
  readonly unused: string[] = [];
  declared = 0;
  #stack: Map<string, number>[] = [new Map()];
  check(program: Stmt[]): this {
    this.#block(program, false);
    return this;
  }
  #in(work: () => void) {
    this.#stack.push(new Map());
    work();
    for (const [n, uses] of this.#stack.pop()!) if (!uses) this.unused.push(n);
  }
  #declare(n: string) {
    this.declared++;
    this.#stack.at(-1)!.set(n, 0);
  }
  #use(n: string) {
    for (let i = this.#stack.length - 1; i >= 0; i--) {
      const u = this.#stack[i].get(n);
      if (u !== undefined) {
        this.#stack[i].set(n, u + 1);
        return;
      }
    }
    this.free.add(n);
  }
  #block(list: Stmt[], own = true) {
    const work = () => {
      for (const s of list) if (s.s === "fn") this.#declare(s.name);
      for (const s of list) this.#stmt(s);
  };
    own ? this.#in(work) : work();
  }
  #stmt(s: Stmt) {
    switch (s.s) {
      case "let": this.#expr(s.e);
      this.#declare(s.name);
      break;
      case "set": this.#expr(s.target);
      this.#expr(s.e);
      break;
      case "expr": this.#expr(s.e);
      break;
      case "if": this.#expr(s.c);
      this.#block(s.a);
      if (s.b) this.#block(s.b);
      break;
      case "while": this.#expr(s.c);
      this.#block(s.body);
      break;
      case "for": this.#expr(s.over);
      this.#in(() => {
        this.#declare(s.name);
        this.#block(s.body);
    });
      break;
      case "return": if (s.e) this.#expr(s.e);
      break;
      case "fn": this.#in(() => {
        s.params.forEach(p => this.#declare(p));
        this.#block(s.body);
    });
    }
  }
  #expr(e: Expr): void {
    switch (e.t) {
      case "name": this.#use(e.v);
      break;
      case "un": this.#expr(e.e);
      break;
      case "bin": this.#expr(e.l);
      this.#expr(e.r);
      break;
      case "call": this.#expr(e.f);
      e.all.forEach(a => this.#expr(a));
      break;
      case "index": this.#expr(e.o);
      this.#expr(e.k);
      break;
      case "dot": this.#expr(e.o);
      break;
      case "list": e.items.forEach(i => this.#expr(i));
      break;
      case "record": e.fields.forEach(([, v]) => this.#expr(v));
      break;
      case "fn": this.#in(() => {
        e.params.forEach(p => this.#declare(p));
        Array.isArray(e.body) ? this.#block(e.body) : this.#expr(e.body);
    });
      break;
      case "if": this.#expr(e.c);
      this.#expr(e.a);
      this.#expr(e.b);
      break;
      case "match": this.#expr(e.e);
      for (const a of e.arms) {
        if (a.pattern) this.#expr(a.pattern);
        this.#expr(a.to);
      }
    }
  }
}
function fold(e: Expr): Expr {
  switch (e.t) {
    case "un": {
      const x = fold(e.e);
      if (e.op === "-" && x.t === "num") return {
        t: "num", v: -x.v
    };
      if (e.op === "!" && x.t === "bool") return {
        t: "bool", v: !x.v
    };
      return {
        t: "un", op: e.op, e: x
    };
    }
    case "bin": {
      const l = fold(e.l), r = fold(e.r);
      if (l.t === "num" && r.t === "num") {
        const f: Record<string, (a: number, b: number) => number | boolean> = {
          "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "<": (a,
            b) => a < b, "==": (a, b) => a === b
      };
        const v = f[e.op]?.(l.v, r.v);
        if (typeof v === "number") return {
          t: "num", v
      };
        if (typeof v === "boolean") return {
          t: "bool", v
      };
      }
      if (l.t === "str" && r.t === "str" && e.op === "+") return {
        t: "str", v: l.v + r.v
    };
      return {
        t: "bin", op: e.op, l, r
    };
    }
    case "call": return {
      t: "call", f: fold(e.f), all: e.all.map(fold)
  };
    case "list": return {
      t: "list", items: e.items.map(fold)
  };
    case "if": {
      const c = fold(e.c);
      if (c.t === "bool") return fold(c.v ? e.a : e.b);
      return {
        t: "if", c, a: fold(e.a), b: fold(e.b)
    };
    }
    case "record": return {
      t: "record", fields: e.fields.map(([n, v]) => [n, fold(v)])
  };
    default: return e;
  }
}
const sample = (n: number) => `# the head of ${n}\nlet limit = ${n} * 2 + 1;\nfn gcd(a, b) { if b == 0 { return a; } return gcd(b, a % b) }\n# a list\nlet items = [1, 2, ${n}, "text ${n}", nil, true, gcd(12, ${n}), fn(x) => x * x, {a: 1, b: [${n}], c: {deep: "v"}}];\nfor i in 0 .. limit { if i % 3 == 0 && !(i == ${n % 5}) { items[i] = -i - (1 - 2) } else if i > 10 || false { break; } else { let unused${n % 3} = i; } }\nlet pick = match items[0] { 1 => "one", 2 => "two", else => "more" + "than" };\nlet f = fn(a, b) { let c = a |> b; while c < ${n} { c = c + (a - b) * 2; } return if c > 1 { c } else { -c }; };\nprint(f(1, gcd).x.y[0](2)(3), undefinedName, (1 + 2) * 3 - (4 - 5), 1 - (2 - 3), !true == false)\n`;
let total = 0, tokens = 0, mixed = 0;
for (let n = 1; n <= 160; n++) {
  const source = sample(n);
  const lexer = new Lexer(source);
  for (const t of lexer) mixed = (mixed * 31 + t.kind + t.at.column) >>> 0;
  tokens += lexer.count;
  const ast = new Parser(source).program();
  const pretty = new Printer(60 + (n % 3) * 20).print(ast), tight = new Printer(60,
    true).print(ast);
  const again = new Printer(60 + (n % 3) * 20).print(new Parser(pretty).program());
  if (again !== pretty) console.log("not stable", n);
  const small = new Printer(60, true).print(new Parser(tight).program());
  if (small !== tight) console.log("tight not stable", n);
  const scopes = new Scopes().check(ast);
  total += pretty.length + tight.length + scopes.declared;
  if (n === 7) {
    console.log(pretty);
    console.log(tight);
    console.log([...scopes.free].join(), scopes.unused.join(), scopes.declared);
  }
  for (const s of ast) if (s.s === "let") mixed = (mixed + new Printer().expr(fold(s.e)).length) >>> 0;
}
console.log(total, tokens, mixed);
for (const bad of ["let = 1", 'let a = "open', "fn f( { }", "1 + ", "a b = ; =", "@",
  "if x { y", "1.2.3", "5 = 6"]) try {
  new Parser(bad).program();
  console.log("fine", bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
