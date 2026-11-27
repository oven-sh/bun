// A language compiled to bytes: scopes, closures, a constant pool, jumps that are patched, a peephole pass, a machine with frames, a disassembler
enum Op {
  Const, Nil, True, False, Pop, Load, Store, Global, SetGlobal, Up, SetUp, Add, Sub, Mul, Div,
    Mod, Neg, Not, Eq, Lt, Gt, Jump, JumpIf, JumpUnless, Loop, Call, Return, Closure, List,
    Index, SetIndex, Print, Inc, AddConst, Halt
}
type Value = number | string | boolean | null | Value[] | Closure | Builtin;
class Builtin {
  constructor(readonly name: string, readonly arity: number,
    readonly run: (all: Value[]) => Value) {
  }
}
class Proto {
  readonly code: number[] = [];
  readonly constants: Value[] = [];
  readonly lines: number[] = [];
  readonly protos: Proto[] = [];
  ups: {
    local: boolean;
    index: number
}[] = [];
  slots = 0;
  constructor(readonly name: string, readonly arity: number) {
  }
  constant(v: Value): number {
    const at = this.constants.findIndex(c => Object.is(c, v));
    return at >= 0 ? at : this.constants.push(v) - 1;
  }
  emit(line: number, ...bytes: number[]): number {
    const at = this.code.length;
    for (const b of bytes) {
      this.code.push(b);
      this.lines.push(line);
    }
    return at;
  }
  patch(at: number) {
    this.code[at + 1] = this.code.length - at - 2;
  }
}
class UpValue {
  closed: Value = null;
  open: boolean = true;
  constructor(public frame: Value[], readonly slot: number) {
  }
  get value(): Value {
    return this.open ? this.frame[this.slot] : this.closed;
  }
  set value(v: Value) {
    if (this.open) this.frame[this.slot] = v;
    else this.closed = v;
  }
  close() {
    this.closed = this.frame[this.slot];
    this.open = false;
  }
}
class Closure {
  constructor(readonly proto: Proto, readonly ups: UpValue[]) {
  }
}
class CompileError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = "CompileError";
  }
}
class RunError extends Error {
  constructor(message: string, readonly trace: string[]) {
    super(message);
    this.name = "RunError";
  }
}
interface Token {
  kind: "num" | "str" | "name" | "op" | "end";
  text: string;
  line: number
}
function lex(source: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  const re = /(\n)|[ \t\r]+|\/\/[^\n]*|(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*)|(==|!=|<=|>=|\+\+|[-+*\/%<>=!(){}\[\],;.])|(.)/y;
  let m: RegExpExecArray | null;
  while (re.lastIndex < source.length && (m = re.exec(source))) {
    if (m[1]) line++;
    else if (m[2] !== undefined) out.push({ kind: "num", text: m[2], line });
    else if (m[3] !== undefined) out.push({ kind: "str", text: m[3].replace(/\\(.)/g, (_,
      c) => (c === "n" ? "\n" : c)), line });
    else if (m[4]) out.push({ kind: "name", text: m[4], line });
    else if (m[5]) out.push({ kind: "op", text: m[5], line });
    else if (m[6]) throw new CompileError("bad character " + m[6], line);
  }
  out.push({ kind: "end", text: "", line });
  return out;
}
interface Local {
  name: string;
  depth: number;
  captured: boolean
}
class Scope {
  readonly locals: Local[] = [];
  depth = 0;
  readonly breaks: number[][] = [];
  constructor(readonly proto: Proto, readonly up: Scope | null) {
  }
  local(name: string): number {
    for (let i = this.locals.length - 1; i >= 0; i--) if (this.locals[i].name === name) return i;
    return -1;
  }
  upvalue(name: string): number {
    if (!this.up) return -1;
    const at = this.up.local(name);
    if (at >= 0) {
      this.up.locals[at].captured = true;
      return this.#add(true, at);
    }
    const higher = this.up.upvalue(name);
    return higher < 0 ? -1 : this.#add(false, higher);
  }
  #add(local: boolean, index: number): number {
    const at = this.proto.ups.findIndex(u => u.local === local && u.index === index);
    return at >= 0 ? at : this.proto.ups.push({ local, index }) - 1;
  }
  declare(name: string): number {
    this.locals.push({ name, depth: this.depth, captured: false });
    this.proto.slots = Math.max(this.proto.slots, this.locals.length);
    return this.locals.length - 1;
  }
}
class Compiler {
  #t: Token[];
  #i = 0;
  #scope: Scope;
  constructor(source: string) {
    this.#t = lex(source);
    this.#scope = new Scope(new Proto("main", 0), null);
  }
  get #p() {
    return this.#scope.proto;
  }
  get #line() {
    return this.#t[Math.max(0, this.#i - 1)].line;
  }
  #is(text: string) {
    const t = this.#t[this.#i];
    return t.text === text && (t.kind === "op" || t.kind === "name");
  }
  #take(text: string) {
    if (this.#is(text)) {
      this.#i++;
      return true;
    }
    return false;
  }
  #need(text: string) {
    if (!this.#take(text)) throw new CompileError(`expected ${text}, got ${this.#t[this.#i].text || "the end"}`,
      this.#t[this.#i].line);
  }
  #name() {
    const t = this.#t[this.#i++];
    if (t.kind !== "name") throw new CompileError("expected a name", t.line);
    return t.text;
  }
  #emit(...b: number[]) {
    return this.#p.emit(this.#line, ...b);
  }
  compile(): Proto {
    while (this.#t[this.#i].kind !== "end") this.#statement();
    this.#emit(Op.Halt);
    return this.#p;
  }
  #block(work: () => void) {
    this.#scope.depth++;
    work();
    this.#scope.depth--;
    while (this.#scope.locals.length &&
      this.#scope.locals.at(-1)!.depth > this.#scope.depth) this.#scope.locals.pop();
  }
  #body() {
    this.#need("{");
    this.#block(() => {
      while (!this.#take("}")) {
        if (this.#t[this.#i].kind === "end") throw new CompileError("open block", this.#line);
        this.#statement();
      }
  });
  }
  #define(name: string) {
    if (this.#scope.up || this.#scope.depth) {
      const slot = this.#scope.declare(name);
      this.#emit(Op.Store, slot);
      this.#emit(Op.Pop);
  } else {
      this.#emit(Op.SetGlobal, this.#p.constant(name));
      this.#emit(Op.Pop);
    }
  }
  #statement() {
    if (this.#take("let")) {
      const name = this.#name();
      if (this.#take("=")) this.#expr();
      else this.#emit(Op.Nil);
      this.#need(";");
      this.#define(name);
      return;
    }
    if (this.#is("fn") && this.#t[this.#i + 1].kind === "name") {
      this.#i++;
      const name = this.#name();
      const inner = this.#scope.up || this.#scope.depth;
      if (inner) {
        const slot = this.#scope.declare(name);
        this.#function(name);
        this.#emit(Op.Store, slot);
        this.#emit(Op.Pop);
    } else {
        this.#function(name);
        this.#emit(Op.SetGlobal, this.#p.constant(name));
        this.#emit(Op.Pop);
      }
      return;
    }
    if (this.#take("print")) {
      this.#expr();
      this.#need(";");
      this.#emit(Op.Print);
      return;
    }
    if (this.#take("if")) {
      this.#expr();
      const skip = this.#emit(Op.JumpUnless, 0);
      this.#body();
      if (this.#take("else")) {
        const end = this.#emit(Op.Jump, 0);
        this.#p.patch(skip);
        if (this.#is("if")) this.#statement();
        else this.#body();
        this.#p.patch(end);
    } else this.#p.patch(skip);
      return;
    }
    if (this.#take("while")) {
      const top = this.#p.code.length;
      this.#expr();
      const out = this.#emit(Op.JumpUnless, 0);
      this.#scope.breaks.push([]);
      this.#body();
      this.#emit(Op.Loop, this.#p.code.length + 2 - top);
      this.#p.patch(out);
      for (const b of this.#scope.breaks.pop()!) this.#p.patch(b);
      return;
    }
    if (this.#take("break")) {
      const list = this.#scope.breaks.at(-1);
      if (!list) throw new CompileError("break outside of a loop", this.#line);
      list.push(this.#emit(Op.Jump, 0));
      this.#need(";");
      return;
    }
    if (this.#take("return")) {
      if (!this.#scope.up) throw new CompileError("return outside of a function", this.#line);
      if (this.#is(";")) this.#emit(Op.Nil);
      else this.#expr();
      this.#need(";");
      this.#emit(Op.Return);
      return;
    }
    if (this.#is("{")) {
      this.#body();
      return;
    }
    this.#expr();
    this.#need(";");
    this.#emit(Op.Pop);
  }
  #function(name: string) {
    this.#need("(");
    const params: string[] = [];
    while (!this.#take(")")) {
      params.push(this.#name());
      if (!this.#is(")")) this.#need(",");
    }
    const scope = new Scope(new Proto(name, params.length), this.#scope);
    const outer = this.#scope;
    this.#scope = scope;
    scope.depth = 1;
    for (const p of params) scope.declare(p);
    this.#body();
    this.#emit(Op.Nil);
    this.#emit(Op.Return);
    this.#scope = outer;
    this.#p.protos.push(scope.proto);
    this.#emit(Op.Closure, this.#p.protos.length - 1);
  }
  static readonly binary: Record<string, [number, Op[]]> = {
    "==": [1, [Op.Eq]], "!=": [1, [Op.Eq, Op.Not]], "<": [2, [Op.Lt]], ">": [2, [Op.Gt]],
      "<=": [2, [Op.Gt, Op.Not]], ">=": [2, [Op.Lt, Op.Not]], "+": [3, [Op.Add]], "-": [3,
      [Op.Sub]], "*": [4, [Op.Mul]], "/": [4, [Op.Div]], "%": [4, [Op.Mod]]
};
  #expr() {
    this.#or();
  }
  #or() {
    this.#and();
    while (this.#take("or")) {
      const end = this.#emit(Op.JumpIf, 0);
      this.#and();
      this.#p.patch(end);
    }
  }
  #and() {
    this.#bin(1);
    while (this.#take("and")) {
      const skip = this.#emit(Op.JumpUnless, 0);
      this.#bin(1);
      const end = this.#emit(Op.Jump, 0);
      this.#p.patch(skip);
      this.#emit(Op.False);
      this.#p.patch(end);
    }
  }
  #bin(min: number) {
    this.#unary();
    for (;;) {
      const t = this.#t[this.#i], b = t.kind === "op" ? Compiler.binary[t.text] : undefined;
      if (!b || b[0] < min) return;
      this.#i++;
      this.#bin(b[0] + 1);
      for (const op of b[1]) this.#emit(op);
    }
  }
  #unary() {
    if (this.#take("-")) {
      this.#unary();
      this.#emit(Op.Neg);
  } else if (this.#take("!")) {
      this.#unary();
      this.#emit(Op.Not);
  } else this.#postfix();
  }
  #postfix() {
    const t = this.#t[this.#i++];
    switch (t.kind) {
      case "num": this.#emit(Op.Const, this.#p.constant(Number(t.text)));
      break;
      case "str": this.#emit(Op.Const, this.#p.constant(t.text));
      break;
      case "name": switch (t.text) {
        case "nil": this.#emit(Op.Nil);
        break;
        case "true": this.#emit(Op.True);
        break;
        case "false": this.#emit(Op.False);
        break;
        case "fn": this.#function("anonymous");
        break;
        default: this.#variable(t.text);
      }
      break;
      case "op": if (t.text === "(") {
        this.#expr();
        this.#need(")");
        break;
      }
      if (t.text === "[") {
        let n = 0;
        while (!this.#take("]")) {
          this.#expr();
          n++;
          if (!this.#is("]")) this.#need(",");
        }
        this.#emit(Op.List, n);
        break;
      }
      default: throw new CompileError("unexpected " + (t.text || "end"), t.line);
    }
    for (;;) {
      if (this.#take("(")) {
        let n = 0;
        while (!this.#take(")")) {
          this.#expr();
          n++;
          if (!this.#is(")")) this.#need(",");
        }
        this.#emit(Op.Call, n);
    } else if (this.#take("[")) {
        this.#expr();
        this.#need("]");
        if (this.#take("=")) {
          this.#expr();
          this.#emit(Op.SetIndex);
      } else this.#emit(Op.Index);
    } else return;
    }
  }
  #variable(name: string) {
    const local = this.#scope.local(name), up = local < 0 ? this.#scope.upvalue(name) : -1;
    if (this.#take("=")) {
      this.#expr();
      if (local >= 0) this.#emit(Op.Store, local);
      else if (up >= 0) this.#emit(Op.SetUp, up);
      else this.#emit(Op.SetGlobal, this.#p.constant(name));
  } else if (local >= 0) {
      if (this.#take("++")) this.#emit(Op.Inc, local);
      else this.#emit(Op.Load, local);
  } else if (up >= 0) this.#emit(Op.Up, up);
    else this.#emit(Op.Global, this.#p.constant(name));
  }
}
const operands: Partial<Record<Op, number>> = {
  [Op.Const]: 1, [Op.Load]: 1, [Op.Store]: 1, [Op.Global]: 1, [Op.SetGlobal]: 1, [Op.Up]: 1,
    [Op.SetUp]: 1, [Op.Jump]: 1, [Op.JumpIf]: 1, [Op.JumpUnless]: 1, [Op.Loop]: 1,
    [Op.Call]: 1, [Op.Closure]: 1, [Op.List]: 1, [Op.Inc]: 1, [Op.AddConst]: 1
};
function* instructions(p: Proto): Generator<[at: number, op: Op, operand: number | null]> {
  for (let i = 0; i < p.code.length; ) {
    const op = p.code[i] as Op, n = operands[op] ?? 0;
    yield [i, op, n ? p.code[i + 1] : null];
    i += 1 + n;
  }
}
function disassemble(p: Proto, depth = 0): string {
  let out = `${"  ".repeat(depth)}${p.name}/${p.arity} slots ${p.slots} ups ${p.ups.map(u => (u.local ? "l" : "u") + u.index).join()}\n`;
  for (const [at, op,
    n] of instructions(p)) out += `${"  ".repeat(depth)}${String(at).padStart(3)} ${Op[op]}${n === null ? "" : " " + n}${op === Op.Const || op === Op.Global ? " " + show(p.constants[n!]) : ""}\n`;
  for (const q of p.protos) out += disassemble(q, depth + 1);
  return out;
}
function show(v: Value): string {
  if (v instanceof Closure) return `<fn ${v.proto.name}>`;
  if (v instanceof Builtin) return `<native ${v.name}>`;
  if (Array.isArray(v)) return "[" + v.map(show).join(", ") + "]";
  return v === null ? "nil" : typeof v === "number" ? String(+v.toFixed(6)) : String(v);
}
interface Frame {
  closure: Closure;
  pc: number;
  slots: Value[];
  open: UpValue[]
}
class Machine {
  readonly globals = new Map<string, Value>();
  readonly out: string[] = [];
  steps = 0;
  readonly counts = new Uint32Array(Op.Halt + 1);
  deepest = 0;
  constructor() {
    const define = (name: string, arity: number,
      run: (all: Value[]) => Value) => this.globals.set(name, new Builtin(name, arity, run));
    define("len", 1, ([v]) => (v as Value[] | string).length);
    define("push", 2, ([l, v]) => ((l as Value[]).push(v), l));
    define("floor", 1, ([n]) => Math.floor(n as number));
    define("text", 1, ([v]) => show(v));
  }
  run(proto: Proto): Value {
    const stack: Value[] = [];
    const frames: Frame[] = [{ closure: new Closure(proto, []), pc: 0,
      slots: new Array(proto.slots).fill(null), open: [] }];
    let f = frames[0], code = proto.code;
    const fail = (message: string): never => {
      throw new RunError(message,
        frames.map(x => `${x.closure.proto.name}:${x.closure.proto.lines[Math.max(0, x.pc - 1)]}`).reverse());
  };
    const num = (v: Value): number => (typeof v === "number" ? v : fail("not a number: " + show(v)));
    for (;;) {
      const op = code[f.pc++] as Op;
      this.steps++;
      this.counts[op]++;
      switch (op) {
        case Op.Const: stack.push(f.closure.proto.constants[code[f.pc++]]);
        break;
        case Op.Nil: stack.push(null);
        break;
        case Op.True: stack.push(true);
        break;
        case Op.False: stack.push(false);
        break;
        case Op.Pop: stack.pop();
        break;
        case Op.Load: stack.push(f.slots[code[f.pc++]]);
        break;
        case Op.Store: f.slots[code[f.pc++]] = stack[stack.length - 1];
        break;
        case Op.Inc: {
          const s = code[f.pc++];
          stack.push(f.slots[s]);
          f.slots[s] = num(f.slots[s]) + 1;
          break;
        }
        case Op.Global: {
          const name = f.closure.proto.constants[code[f.pc++]] as string;
          const v = this.globals.get(name);
          if (v === undefined) fail("undefined " + name);
          stack.push(v!);
          break;
        }
        case Op.SetGlobal: this.globals.set(f.closure.proto.constants[code[f.pc++]] as string,
          stack[stack.length - 1]);
        break;
        case Op.Up: stack.push(f.closure.ups[code[f.pc++]].value);
        break;
        case Op.SetUp: f.closure.ups[code[f.pc++]].value = stack[stack.length - 1];
        break;
        case Op.Add: {
          const b = stack.pop()!, a = stack.pop()!;
          stack.push(typeof a === "number" &&
            typeof b === "number" ? a + b : typeof a === "string" ||
            typeof b === "string" ? show(a) + show(b) : Array.isArray(a) &&
            Array.isArray(b) ? [...a, ...b] : fail(`cannot add ${show(a)} and ${show(b)}`));
          break;
        }
        case Op.Sub: {
          const b = num(stack.pop()!);
          stack.push(num(stack.pop()!) - b);
          break;
        }
        case Op.Mul: {
          const b = num(stack.pop()!);
          stack.push(num(stack.pop()!) * b);
          break;
        }
        case Op.Div: {
          const b = num(stack.pop()!);
          if (b === 0) fail("division by zero");
          stack.push(num(stack.pop()!) / b);
          break;
        }
        case Op.Mod: {
          const b = num(stack.pop()!);
          stack.push(num(stack.pop()!) % b);
          break;
        }
        case Op.Neg: stack.push(-num(stack.pop()!));
        break;
        case Op.Not: {
          const v = stack.pop()!;
          stack.push(v === false || v === null);
          break;
        }
        case Op.Eq: {
          const b = stack.pop()!;
          stack.push(stack.pop()! === b);
          break;
        }
        case Op.Lt: {
          const b = num(stack.pop()!);
          stack.push(num(stack.pop()!) < b);
          break;
        }
        case Op.Gt: {
          const b = num(stack.pop()!);
          stack.push(num(stack.pop()!) > b);
          break;
        }
        case Op.Jump: f.pc += code[f.pc] + 1;
        break;
        case Op.JumpUnless: {
          const by = code[f.pc++], v = stack.pop()!;
          if (v === false || v === null) f.pc += by;
          break;
        }
        case Op.JumpIf: {
          const by = code[f.pc++], v = stack[stack.length - 1];
          if (v === false || v === null) stack.pop();
          else f.pc += by;
          break;
        }
        case Op.Loop: f.pc += 1 - code[f.pc];
        break;
        case Op.Closure: {
          const p = f.closure.proto.protos[code[f.pc++]];
          const frame = f;
          stack.push(new Closure(p, p.ups.map(u => {
            if (!u.local) return frame.closure.ups[u.index];
            let open = frame.open.find(o => o.slot === u.index);
            if (!open) frame.open.push((open = new UpValue(frame.slots, u.index)));
            return open;
        })));
          break;
        }
        case Op.Call: {
          const n = code[f.pc++], all = stack.splice(stack.length - n, n),
            callee = stack.pop()!;
          if (callee instanceof Builtin) {
            if (callee.arity !== n) fail(`${callee.name} takes ${callee.arity}`);
            stack.push(callee.run(all));
            break;
          }
          if (!(callee instanceof Closure)) return fail("not a function: " + show(callee));
          if (callee.proto.arity !== n) fail(`${callee.proto.name} takes ${callee.proto.arity}, got ${n}`);
          if (frames.length > 2000) fail("too deep");
          const slots: Value[] = all;
          while (slots.length < callee.proto.slots) slots.push(null);
          f = {
            closure: callee, pc: 0, slots, open: []
        };
          frames.push(f);
          if (frames.length > this.deepest) this.deepest = frames.length;
          code = callee.proto.code;
          break;
        }
        case Op.Return: for (const o of f.open) o.close();
        frames.pop();
        f = frames[frames.length - 1];
        code = f.closure.proto.code;
        break;
        case Op.List: {
          const n = code[f.pc++];
          stack.push(stack.splice(stack.length - n, n));
          break;
        }
        case Op.Index: {
          const k = stack.pop()!, o = stack.pop()!;
          if (!Array.isArray(o) &&
            typeof o !== "string") return fail("cannot index " + show(o));
          const v = o[num(k)];
          stack.push(v === undefined ? fail("no item " + show(k)) : v);
          break;
        }
        case Op.SetIndex: {
          const v = stack.pop()!, k = num(stack.pop()!), o = stack.pop()!;
          if (!Array.isArray(o)) return fail("cannot set in " + show(o));
          o[k] = v;
          stack.push(v);
          break;
        }
        case Op.Print: this.out.push(show(stack.pop()!));
        break;
        case Op.Halt: return stack.pop() ?? null;
        default: fail("bad code " + op);
      }
    }
  }
}
const programs = {
  closures: 'fn counter(step) { let n = 0; fn next() { n = n + step; return n; } return next; } let a = counter(1); let b = counter(10); let i = 0; while (i < 3000) { a(); b(); i = i + 1; } print a() + b();',
    fib: "fn fib(n) { if n < 2 { return n; } return fib(n - 1) + fib(n - 2); } print fib(21);",
    sieve: "let n = 8000; let s = []; let i = 0; while i <= n { push(s, true); i = i + 1; } let count = 0; i = 2; while i <= n { if s[i] { count = count + 1; let k = i * i; while k <= n { s[k] = false; k = k + i; } } i = i + 1; } print count;",
    sort: 'fn sort(l) { if len(l) < 2 { return l; } let p = l[0]; let a = []; let b = []; let i = 1; while i < len(l) { if l[i] < p { push(a, l[i]); } else { push(b, l[i]); } i++; } return sort(a) + [p] + sort(b); } let l = []; let x = 7; let i = 0; while i < 900 { x = (x * 48271) % 65537; push(l, x % 1000); i = i + 1; } let r = sort(l); print r[0] + ":" + r[450] + ":" + r[899];',
    logic: 'print (1 < 2 and "yes") or "no"; print nil or false or 3; print !nil; print 1 == 1.0; print "a" + 1 + nil; print [1, [2, "x"]]; print -3 % 2; print text([1]) + "!";',
    breaks: "let i = 0; let sum = 0; while true { i = i + 1; if i > 5000 { break; } if i % 3 == 0 { sum = sum + i; } else if i % 5 == 0 { sum = sum - i; } else { { let i2 = i; sum = sum + i2 % 2; } } } print sum;",
    makers: "fn make(n) { let fs = []; let i = 0; while i < n { let k = i; push(fs, fn() { k = k + 1; return k * i; }); i++; } return fs; } let fs = make(4); let j = 0; while j < 4 { print fs[j]() + fs[j](); j = j + 1; }"
};
let steps = 0;
for (let round = 0; round < 4; round++) for (const [name, source] of Object.entries(programs)) {
  const proto = new Compiler(source).compile();
  const m = new Machine();
  m.run(proto);
  steps += m.steps;
  if (round === 0) {
    console.log(name, m.out.join(" | "), m.steps, m.deepest, [...m.counts].map((n, op) => [n,
      Op[op]] as const).sort((a, b) => b[0] - a[0]).slice(0,
      3).map(x => x.join(" ")).join(", "));
    if (name === "closures") console.log(disassemble(proto));
  }
}
console.log(steps);
for (const bad of ["let = 1;", "print 1", "fn f( {", "@", "return 1;", "break;",
  "while true {", "print nope;", "print 1 / 0;", "print [1][5];", 'print "a" - 1;',
  "fn f(a) { return a(); } fn g() { return f(1); } g();", "fn r() { return r(); } r();",
  "len(1, 2);", "5();"]) try {
  new Machine().run(new Compiler(bad).compile());
  console.log("fine", bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message, e instanceof RunError ? e.trace.slice(0,
    3).join("<") : "");
}
