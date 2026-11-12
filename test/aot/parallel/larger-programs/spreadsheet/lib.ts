// Cells with formulas: a parser, a graph of what depends on what, cycles, ranges, functions, undo and columns that are sorted
export type Cell = {
  kind: "empty"
} | {
  kind: "number";
  value: number
} | {
  kind: "text";
  value: string
} | {
  kind: "formula";
  source: string;
  ast: Expr
};
export type Expr = {
  t: "num";
  v: number
} | {
  t: "str";
  v: string
} | {
  t: "ref";
  at: string
} | {
  t: "range";
  from: string;
  to: string
} | {
  t: "bin";
  op: string;
  l: Expr;
  r: Expr
} | {
  t: "neg";
  e: Expr
} | {
  t: "call";
  name: string;
  all: Expr[]
};
export enum ErrorKind {
  Cycle = "#CYCLE!", Value = "#VALUE!", Ref = "#REF!", Div = "#DIV/0!", Name = "#NAME?"
}
export class CellError {
  private static kept = new Map<ErrorKind, CellError>();
  private constructor(readonly kind: ErrorKind) {
  }
  static of(kind: ErrorKind) {
    if (!this.kept.has(kind)) this.kept.set(kind, new CellError(kind));
    return this.kept.get(kind)!;
  }
  toString() {
    return this.kind;
  }
}
export type Result = number | string | boolean | CellError | null;
export namespace Address {
  export const parse = (at: string): [number, number] => {
    const m = /^([A-Z]+)(\d+)$/.exec(at);
    if (!m) throw new RangeError("bad address " + at);
    let column = 0;
    for (const c of m[1]) column = column * 26 + c.charCodeAt(0) - 64;
    return [column - 1, +m[2] - 1];
};
  export const print = (column: number, row: number): string => {
    let out = "";
    for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out + (row + 1);
};
  export function* range(from: string, to: string): Generator<string> {
    const [a, b] = parse(from), [c, d] = parse(to);
    for (let row = Math.min(b, d); row <= Math.max(b, d); row++) for (let column = Math.min(a,
      c); column <= Math.max(a, c); column++) yield print(column, row);
  }
}
export class FormulaParser {
  #tokens: RegExpMatchArray[];
  #i = 0;
  constructor(readonly source: string) {
    this.#tokens = [...source.matchAll(/\s*(?:(\d+(?:\.\d+)?)|([A-Z]+\d+)|([A-Z]+)(?=\()|"([^"]*)"|(<=|>=|<>|[-+*\/^&=<>(),:]))/g)];
    if (this.#tokens.reduce((n, t) => n + t[0].length,
      0) !== source.trimEnd().length) throw new SyntaxError("bad formula " + source);
  }
  #peek(op: string) {
    return this.#tokens[this.#i]?.[5] === op;
  }
  #take(op: string) {
    if (this.#peek(op)) {
      this.#i++;
      return true;
    }
    return false;
  }
  parse(): Expr {
    const e = this.#binary(0);
    if (this.#i < this.#tokens.length) throw new SyntaxError("more in " + this.source);
    return e;
  }
  static readonly levels = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"],
    ["^"]];
  #binary(level: number): Expr {
    if (level === FormulaParser.levels.length) return this.#unary();
    let l = this.#binary(level + 1);
    for (;;) {
      const op = this.#tokens[this.#i]?.[5];
      if (!op || !FormulaParser.levels[level].includes(op)) return l;
      this.#i++;
      l = {
        t: "bin", op, l, r: this.#binary(op === "^" ? level : level + 1)
    };
    }
  }
  #unary(): Expr {
    if (this.#take("-")) return {
      t: "neg", e: this.#unary()
  };
    const t = this.#tokens[this.#i++];
    if (!t) throw new SyntaxError("end of " + this.source);
    if (t[1] !== undefined) return {
      t: "num", v: +t[1]
  };
    if (t[4] !== undefined) return {
      t: "str", v: t[4]
  };
    if (t[2] !== undefined) {
      if (this.#take(":")) {
        const to = this.#tokens[this.#i++];
        if (!to?.[2]) throw new SyntaxError("range in " + this.source);
        return {
          t: "range", from: t[2], to: to[2]
      };
      }
      return {
        t: "ref", at: t[2]
    };
    }
    if (t[3] !== undefined) {
      this.#i++;
      const all: Expr[] = [];
      if (!this.#take(")")) {
        do all.push(this.#binary(0));
        while (this.#take(","));
        if (!this.#take(")")) throw new SyntaxError("open call in " + this.source);
      }
      return {
        t: "call", name: t[3], all
    };
    }
    if (t[5] === "(") {
      const e = this.#binary(0);
      if (!this.#take(")")) throw new SyntaxError("open ( in " + this.source);
      return e;
    }
    throw new SyntaxError("unexpected " + t[0]);
  }
}
export function refs(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case "ref": out.add(e.at);
    break;
    case "range": for (const at of Address.range(e.from, e.to)) out.add(at);
    break;
    case "bin": refs(e.l, out);
    refs(e.r, out);
    break;
    case "neg": refs(e.e, out);
    break;
    case "call": for (const a of e.all) refs(a, out);
  }
  return out;
}
export type Fn = (values: (Result | Result[])[]) => Result;
export const flat = (values: (Result | Result[])[]) => values.flat() as Result[];
export const numbers = (values: (Result | Result[])[]) => flat(values).filter((v): v is number => typeof v === "number");
export const functions: Record<string, Fn> = {
  SUM: v => numbers(v).reduce((a, b) => a + b, 0), AVG: v => {
    const n = numbers(v);
    return n.length ? n.reduce((a, b) => a + b, 0) / n.length : CellError.of(ErrorKind.Div);
}, MIN: v => Math.min(...numbers(v)), MAX: v => Math.max(...numbers(v)),
  COUNT: v => numbers(v).length, IF: ([c, a, b]) => ((c ? a : b) ?? null) as Result,
  ROUND: ([x, n]) => +(x as number).toFixed((n as number) ?? 0),
  CONCAT: v => flat(v).map(x => x ?? "").join(""), LEN: ([t]) => String(t ?? "").length,
  ABS: ([x]) => Math.abs(x as number), LOOKUP: ([k, keys, values]) => {
    const i = (keys as Result[]).indexOf(k as Result);
    return i < 0 ? CellError.of(ErrorKind.Ref) : (values as Result[])[i];
  }
};
export interface Change {
  at: string;
  before: Cell;
  after: Cell
}
export class Sheet {
  readonly #cells = new Map<string, Cell>();
  readonly #users = new Map<string, Set<string>>();
  readonly #values = new Map<string, Result>();
  readonly #undo: Change[][] = [];
  readonly #redo: Change[][] = [];
  #batch: Change[] | null = null;
  evaluated = 0;
  readonly watchers: ((at: string, value: Result) => void)[] = [];
  static read(text: string): Cell {
    if (text === "") return {
      kind: "empty"
  };
    if (text[0] === "=") return {
      kind: "formula", source: text.slice(1), ast: new FormulaParser(text.slice(1)).parse()
  };
    const n = Number(text);
    return text.trim() !== "" && !Number.isNaN(n) ? {
      kind: "number", value: n
  } : {
      kind: "text", value: text
  };
  }
  cell(at: string): Cell {
    return this.#cells.get(at) ?? {
      kind: "empty"
  };
  }
  set(at: string, text: string): this {
    Address.parse(at);
    this.#put(at, Sheet.read(text), true);
    return this;
  }
  #put(at: string, after: Cell, record: boolean) {
    const before = this.cell(at);
    if (before.kind === "formula") for (const r of refs(before.ast)) this.#users.get(r)?.delete(at);
    if (after.kind === "empty") this.#cells.delete(at);
    else this.#cells.set(at, after);
    if (after.kind === "formula") for (const r of refs(after.ast)) {
      let s = this.#users.get(r);
      if (!s) this.#users.set(r, (s = new Set()));
      s.add(at);
    }
    if (record) {
      const change = {
        at, before, after
    };
      if (this.#batch) this.#batch.push(change);
      else this.#undo.push([change]);
      this.#redo.length = 0;
    }
    this.#dirty(at);
  }
  #dirty(at: string, seen = new Set<string>()) {
    if (seen.has(at)) return;
    seen.add(at);
    this.#values.delete(at);
    for (const user of this.#users.get(at) ?? []) this.#dirty(user, seen);
    if (seen.size && this.watchers.length) for (const w of this.watchers) w(at, null);
  }
  batch<T>(work: () => T): T {
    this.#batch = [];
    try {
      return work();
  } finally {
      if (this.#batch.length) this.#undo.push(this.#batch);
      this.#batch = null;
    }
  }
  undo(): boolean {
    const b = this.#undo.pop();
    if (!b) return false;
    for (let i = b.length - 1; i >= 0; i--) this.#put(b[i].at, b[i].before, false);
    this.#redo.push(b);
    return true;
  }
  redo(): boolean {
    const b = this.#redo.pop();
    if (!b) return false;
    for (const c of b) this.#put(c.at, c.after, false);
    this.#undo.push(b);
    return true;
  }
  value(at: string, path: Set<string> = new Set()): Result {
    if (this.#values.has(at)) return this.#values.get(at)!;
    const cell = this.cell(at);
    if (cell.kind !== "formula") {
      const v = cell.kind === "empty" ? null : cell.value;
      this.#values.set(at, v);
      return v;
    }
    if (path.has(at)) return CellError.of(ErrorKind.Cycle);
    path.add(at);
    this.evaluated++;
    const v = this.#eval(cell.ast, path) as Result;
    path.delete(at);
    if (!(v instanceof CellError && v.kind === ErrorKind.Cycle &&
      path.size)) this.#values.set(at, v);
    return v;
  }
  #eval(e: Expr, path: Set<string>): Result | Result[] {
    switch (e.t) {
      case "num": case "str": return e.v;
      case "ref": return this.value(e.at, path);
      case "range": return [...Address.range(e.from, e.to)].map(at => this.value(at, path));
      case "neg": {
        const v = this.#eval(e.e, path);
        return v instanceof CellError ? v : typeof v === "number" ? -v : CellError.of(ErrorKind.Value);
      }
      case "call": {
        const f = functions[e.name];
        if (!f) return CellError.of(ErrorKind.Name);
        const all = e.all.map(a => this.#eval(a, path));
        const bad = e.name === "IF" ? undefined : flat(all).find(v => v instanceof CellError);
        return bad ?? f(all);
      }
      case "bin": {
        const l = this.#eval(e.l, path), r = this.#eval(e.r, path);
        if (l instanceof CellError) return l;
        if (r instanceof CellError) return r;
        if (e.op === "&") return String(l ?? "") + String(r ?? "");
        if (e.op === "=") return l === r;
        if (e.op === "<>") return l !== r;
        const a = l ?? 0, b = r ?? 0;
        if (typeof a !== "number" ||
          typeof b !== "number") return CellError.of(ErrorKind.Value);
        switch (e.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? CellError.of(ErrorKind.Div) : a / b;
          case "^": return a ** b;
          case "<": return a < b;
          case ">": return a > b;
          case "<=": return a <= b;
          default: return a >= b;
        }
      }
    }
  }
  print(columns: number, rows: number): string {
    const table: string[][] = [];
    for (let y = 0; y < rows; y++) {
      const row: string[] = [];
      for (let x = 0; x < columns; x++) {
        const v = this.value(Address.print(x, y));
        row.push(v === null ? "" : typeof v === "number" &&
          !Number.isInteger(v) ? v.toFixed(2) : String(v));
      }
      table.push(row);
    }
    const widths = table[0].map((_, i) => Math.max(...table.map(r => r[i].length)));
    return table.map(r => r.map((c, i) => c.padStart(widths[i])).join("|")).join("\n");
  }
}
