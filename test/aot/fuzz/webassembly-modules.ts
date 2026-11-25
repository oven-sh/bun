// WebAssembly modules: accesses inside the memory, at its end and beyond it, traps between stores, calls of every kind, imports that call back, throw, grow the memory and change tables and globals, two instances of one module
import type { Random } from "./random";

let R: () => number;
let isAligned = false;
const int = (n: number) => Math.floor(R() * n);
const pick = (items: readonly any[]): any => items[int(items.length)];
const chance = (p: number) => R() < p;

const I32 = 0x7f,
  I64 = 0x7e,
  F32 = 0x7d,
  F64 = 0x7c,
  FUNCREF = 0x70;
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
const f64bytes = v => [...new Uint8Array(new Float64Array([v]).buffer)];
const f32bytes = v => [...new Uint8Array(new Float32Array([v]).buffer)];

const I32S = [
  0, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 33, 63, 64, 100, 127, 128, 255, 256, 1000, 4095, 4096, 32767, 32768, 65528,
  65532, 65535, 65536, 65537, 131072, 0x7ffffff0, 0x7fffffff, -0x80000000, -0x7fffffff, -1, -2, -4, -7, -8, -16, -32,
  -64, -128, -129, -256, -32768, -65536, 0x55555555, 0x0f0f0f0f, 0x01010101, 0x12345678, -559038737,
];
const I64S = [
  0n,
  1n,
  2n,
  7n,
  8n,
  31n,
  32n,
  63n,
  64n,
  127n,
  128n,
  255n,
  65535n,
  65536n,
  0x7fffffffn,
  0x80000000n,
  0xffffffffn,
  0x100000000n,
  0x100000008n,
  0x1000000ffn,
  0x7fffffffffffffffn,
  -0x8000000000000000n,
  -1n,
  -2n,
  -8n,
  -64n,
  -128n,
  -129n,
  -0x80000000n,
  -0x80000001n,
  -0x100000000n,
  0x123456789abcdefn,
  -0x123456789abcdefn,
  0xffffffff0000n,
  0x5555555555555555n,
];
const FS = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1.5,
  2.5,
  3.7,
  -3.7,
  100,
  1e10,
  -1e10,
  2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967295,
  4294967296,
  9007199254740993,
  9223372036854774784,
  9223372036854775808,
  -9223372036854775808,
  18446744073709549568,
  18446744073709551616,
  1e300,
  1e-310,
  5e-324,
  3.4028234663852886e38,
  1e-40,
  Infinity,
  -Infinity,
  NaN,
  Math.PI,
];

class Module {
  [name: string]: any;

  constructor(style: string) {
    this.style = style;
    this.types = [];
    this.typeIndex = new Map();
    this.hasMemory = !chance(0.06);
    this.memoryImported = this.hasMemory && chance(0.15);
    this.shared = this.hasMemory && chance(0.08);
    this.memMin = pick([1, 1, 1, 2]);
    this.memMax = this.memMin + pick([0, 1, 2, 3]);
    this.hasMax = this.shared || chance(0.7);
    this.imports = [];
    this.globals = [];
    this.funcs = [];
    this.makeGlobals();
    this.makeImports();
    this.tableSize = 8;
    const n = 4 + int(9);
    for (let i = 0; i < n; i++) {
      const f = chance(0.22) ? { params: [I32], results: [I32], resumable: chance(0.85) } : this.makeSignature();
      this.funcs.push(f);
    }
    this.numFuncs = n;
    this.hasTailCalls = chance(this.style === "mixed" ? 0.5 : 0.04);
    this.hasExceptions = chance(this.style === "mixed" ? 0.6 : 0.05);
    this.dataSegments = [];
    this.elements = Array.from({ length: this.tableSize - 1 }, () => int(this.imports.length + this.numFuncs));
    if (this.hasMemory) {
      for (let i = int(3); i-- > 0;)
        this.dataSegments.push({
          passive: false,
          at: int(60000),
          bytes: Array.from({ length: int(200) }, () => int(256)),
        });
      this.passive = chance(0.4)
        ? this.dataSegments.push({ passive: true, bytes: Array.from({ length: 1 + int(100) }, () => int(256)) }) - 1
        : -1;
    } else this.passive = -1;
  }
  type(params, results) {
    const key = params + "|" + results;
    if (!this.typeIndex.has(key)) {
      this.typeIndex.set(key, this.types.length);
      this.types.push({ params, results });
    }
    return this.typeIndex.get(key);
  }
  makeGlobals() {
    const add = (type, mutable, init, extra = {}) => {
      this.globals.push({ type, mutable, init, ...extra });
      return this.globals.length - 1;
    };
    const first = int(12);
    if (first === 0) add(I32, false, 12345);
    if (first === 1) add(I64, true, 0x1234567890n);
    if (first === 2) add(I32, true, 4096, { exported: true });
    const passed = add(I32, true, pick([65000, 32768, 4096, 65000, 32768, 4096, 1024, 0, 65536, -8, 16]));
    this.fuel = chance(0.15) ? passed : add(I32, true, 0);
    this.stackPointer = passed;
    this.spInit = this.globals[passed].init;
    if (chance(0.6)) add(I32, true, pick(I32S));
    if (chance(0.7)) add(I64, true, pick(I64S));
    if (chance(0.4)) add(I64, true, pick([4096n, 65000n, 0x100001000n, -8n]));
    if (chance(0.4)) add(F64, true, pick(FS));
    if (chance(0.3)) add(F32, true, pick(FS));
    if (chance(0.3)) add(I32, false, pick(I32S));
    if (chance(0.2)) add(I64, true, pick(I64S), { exported: true });
  }
  makeImports() {
    const kinds = [
      { name: "h0", params: [I32], results: [I32] },
      { name: "h1", params: [I32, I64], results: [I64] },
      { name: "h2", params: [F64, F32], results: [F64] },
      { name: "h3", params: [], results: [] },
      { name: "h4", params: [I32], results: [I32, I64] },
      { name: "h5", params: [I64, I32, F32, I32, I32, F64, I32, I32, I32, I32, I32, I64], results: [I32] },
    ];
    for (const k of kinds) if (chance(0.45)) this.imports.push(k);
  }
  sameSignature(x, f) {
    const g = x < this.imports.length ? this.imports[x] : this.funcs[x - this.imports.length];
    return String(g.params) === String(f.params) && String(g.results) === String(f.results);
  }
  makeSignature() {
    const t = () => pick([I32, I32, I32, I32, I64, I64, F64, F32]);
    const n = chance(0.1) ? 8 + int(8) : int(5);
    const params = Array.from({ length: n }, t);
    if (n && chance(0.5)) params[0] = I32;
    const r = R();
    const results = r < 0.12 ? [] : r < 0.85 ? [t()] : Array.from({ length: 2 + int(chance(0.2) ? 9 : 2) }, t);
    return { params, results };
  }
  bytes() {
    const importCount = this.imports.length;
    this.importCount = importCount;
    const importEntries = this.imports.map(i => [
      ...str("env"),
      ...str(i.name),
      0,
      ...uleb(this.type(i.params, i.results)),
    ]);
    const limits = () => [
      this.shared ? 3 : this.hasMax ? 1 : 0,
      ...uleb(this.memMin),
      ...(this.hasMax || this.shared ? uleb(this.memMax) : []),
    ];
    if (this.memoryImported) importEntries.push([...str("env"), ...str("memory"), 2, ...limits()]);
    this.funcs.forEach(f => (f.type = this.type(f.params, f.results)));
    if (this.hasExceptions) this.tagType = this.type([I32], []);
    const bodies = this.funcs.map((f, i) => new Body(this, f, i).generate());
    // getters and setters of globals
    const extra: any[] = [];
    this.globals.forEach((g, i) => {
      extra.push({ name: "get" + i, type: this.type([], [g.type]), body: [0, 0x23, ...uleb(i), 0x0b] });
      if (g.mutable)
        extra.push({ name: "set" + i, type: this.type([g.type], []), body: [0, 0x20, 0, 0x24, ...uleb(i), 0x0b] });
    });
    const out = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
    const typeSection = () =>
      section(1, vec(this.types.map(t => [0x60, ...vec(t.params.map(p => [p])), ...vec(t.results.map(p => [p]))])));
    out.push(...typeSection());
    if (importEntries.length) out.push(...section(2, vec(importEntries)));
    out.push(...section(3, vec([...this.funcs.map(f => uleb(f.type)), ...extra.map(e => uleb(e.type))])));
    out.push(...section(4, vec([[FUNCREF, 1, ...uleb(this.tableSize), ...uleb(this.tableSize + 4)]])));
    if (this.hasMemory && !this.memoryImported) out.push(...section(5, vec([limits()])));
    if (this.hasExceptions) out.push(...section(13, vec([[0, ...uleb(this.tagType)]])));
    out.push(...section(6, vec(this.globals.map(g => [g.type, g.mutable ? 1 : 0, ...constant(g.type, g.init), 0x0b]))));
    const exports: any[] = [];
    this.funcs.forEach((f, i) => {
      if (!f.hidden) exports.push([...str("f" + i), 0, ...uleb(importCount + i)]);
    });
    extra.forEach((e, i) => exports.push([...str(e.name), 0, ...uleb(importCount + this.numFuncs + i)]));
    if (this.hasMemory) exports.push([...str("memory"), 2, 0]);
    exports.push([...str("table"), 1, 0]);
    this.globals.forEach((g, i) => {
      if (g.exported) exports.push([...str("g" + i), 3, ...uleb(i)]);
    });
    out.push(...section(7, vec(exports)));
    const elements: any[] = [];
    for (const e of this.elements) elements.push(uleb(e));
    out.push(...section(9, vec([[0, 0x41, 0, 0x0b, ...vec(elements)]])));
    if (this.passive >= 0) out.push(...section(12, uleb(this.dataSegments.length)));
    out.push(...section(10, vec([...bodies, ...extra.map(e => e.body)].map(b => [...uleb(b.length), ...b]))));
    if (this.dataSegments.length)
      out.push(
        ...section(
          11,
          vec(
            this.dataSegments.map(d =>
              d.passive
                ? [1, ...vec(d.bytes.map(b => [b]))]
                : [0, 0x41, ...sleb(d.at), 0x0b, ...vec(d.bytes.map(b => [b]))],
            ),
          ),
        ),
      );
    return new Uint8Array(out);
  }
}

function constant(t: number, v: any): number[] {
  switch (t) {
    case I32:
      return [0x41, ...sleb(v | 0)];
    case I64:
      return [0x42, ...sleb(BigInt.asIntN(64, BigInt(v)))];
    case F32:
      return [0x43, ...f32bytes(v)];
    default:
      return [0x44, ...f64bytes(v)];
  }
}
const randomConstant = t =>
  t === I32
    ? constant(I32, chance(0.7) ? pick(I32S) : int(4294967296) | 0)
    : t === I64
      ? constant(I64, chance(0.8) ? pick(I64S) : (BigInt(int(4294967296)) << 32n) | BigInt(int(4294967296)))
      : constant(t, chance(0.8) ? pick(FS) : (R() - 0.5) * 1e6);

class Body {
  [name: string]: any;

  constructor(m: Module, f: any, index: number) {
    this.m = m;
    this.f = f;
    this.index = index;
    this.locals = [...f.params];
    const extra = 1 + int(7);
    this.extra = Array.from({ length: extra }, () => pick([I32, I32, I32, I64, I64, F64, F32]));
    this.locals.push(...this.extra);
    this.isLeaf = chance(0.35) || index >= m.numFuncs - 2;
    this.callsLeft = this.isLeaf ? 0 : 1 + int(5);
    this.budget = m.style === "big" ? 300 + int(1500) : 30 + int(m.style === "small" ? 40 : 170);
    if (m.style === "big") {
      this.callsLeft *= 3;
      for (let i = int(24); i-- > 0;) {
        const t = pick([I32, I32, I64, F64, F32]);
        this.locals.push(t);
        this.extra.push(t);
      }
    }
    this.out = [];
    this.labels = [];
    this.loopDepth = 0;
    this.kept = new Set();
    this.pointers = [];
    this.sp = -1;
  }
  e(...b: any[]): void {
    for (const x of b)
      if (Array.isArray(x)) {
        for (const y of x) this.out.push(y);
      } else this.out.push(x);
  }
  localsOf(t) {
    const r: any[] = [];
    this.locals.forEach((x, i) => x === t && r.push(i));
    return r;
  }
  globalsOf(t, mutable = false) {
    const r: any[] = [];
    this.m.globals.forEach(
      (g, i) => g.type === t && (!mutable || g.mutable) && i !== (mutable ? this.m.fuel : -1) && r.push(i),
    );
    return r;
  }
  // Go's shape: a switch on the only parameter before anything else. The result says whether the function was left.
  generateResumable() {
    const { m, f } = this;
    const t = this.locals.length;
    this.locals.push(I32);
    this.extra.push(I32);
    this.kept.add(t);
    if (chance(0.4)) this.e(0x23, uleb(m.stackPointer), 0x21, uleb(t));
    const c = this.locals.length;
    this.locals.push(I32);
    this.extra.push(I32);
    this.kept.add(c);
    const hasLoop = chance(0.5),
      hasBlock = chance(0.5),
      n = 1 + int(4);
    if (hasBlock) {
      this.e(0x02, 0x40);
      this.push("block", []);
    }
    if (hasLoop) {
      this.e(0x03, 0x40);
      this.push("loop", []);
    }
    for (let i = 0; i < n; i++) {
      this.e(0x02, 0x40);
      this.push("block", []);
    }
    this.e(0x20, 0, 0x0e, vec(Array.from({ length: n - 1 }, (_, i) => uleb(i))), uleb(n - 1));
    for (let i = 0; i < n; i++) {
      this.labels.pop();
      this.e(0x0b);
      const back = n - 1 - i + 0;
      // fuel
      this.e(
        0x23,
        uleb(m.fuel),
        0x41,
        1,
        0x6b,
        0x24,
        uleb(m.fuel),
        0x23,
        uleb(m.fuel),
        0x41,
        1,
        0x48,
        0x04,
        0x40,
        constant(I32, int(2)),
        0x0f,
        0x0b,
      );
      this.stmts(3, 1 + int(3));
      if (chance(0.4)) {
        this.e(0x20, 0, 0x21, uleb(t));
      }
      if (chance(0.5)) {
        // a call that may be left
        const r = m.funcs
          .map((g, x) => x)
          .filter(x => String(m.funcs[x].params) === String([I32]) && String(m.funcs[x].results) === String([I32]));
        if (r.length && this.callsLeft-- > 0) {
          if (chance(0.75)) this.e(constant(I32, 0));
          else this.leaf(I32);
          this.e(0x10, uleb(m.importCount + pick(r)));
          if (chance(0.4)) this.e(0x22, uleb(c));
          if (chance(0.6)) {
            this.e(0x04, 0x40, constant(I32, pick([0, 1, 1, 7])), 0x0f, 0x0b);
          } else if (chance(0.5)) this.e(0x0d, uleb(this.labels.length - 1 - (hasBlock ? 0 : this.labels.length - 1)));
          else this.e(0x1a);
        }
      }
      if (hasLoop && chance(0.35)) {
        this.e(constant(I32, int(n + 1)), 0x21, 0, 0x0c, uleb(this.labels.length - 1 - (hasBlock ? 1 : 0)));
      } else if (chance(0.3)) {
        this.e(constant(I32, pick([0, 1, 5])), 0x0f);
      }
    }
    if (hasLoop) {
      this.labels.pop();
      this.e(0x0b);
    }
    if (hasBlock) {
      this.labels.pop();
      this.e(0x0b);
    }
    if (chance(0.6)) this.e(constant(I32, pick([0, 0, 1, 3])));
    else if (chance(0.5)) this.e(0x20, uleb(pick([0, t, c])));
    else this.expr(I32, 2);
    this.e(0x0b);
    return [...vec(this.extra.map(t => [1, t])), ...this.out];
  }
  generate() {
    const { m, f } = this;
    if (f.resumable) return this.generateResumable();
    if (!this.isLeaf) {
      // prologue: consume fuel, leave when there is none
      const form = int(3);
      if (form === 0) {
        // Go's and LLVM's shape: an arm without else
        this.e(0x23, uleb(m.fuel), 0x41, sleb(1), 0x6b, 0x24, uleb(m.fuel));
        this.e(0x23, uleb(m.fuel), 0x41, 0, 0x4c, 0x04, 0x40);
        this.defaults();
        this.e(0x0f, 0x0b);
      } else if (form === 1) {
        this.e(
          0x23,
          uleb(m.fuel),
          0x41,
          sleb(-1),
          0x6a,
          0x24,
          uleb(m.fuel),
          0x02,
          0x40,
          0x23,
          uleb(m.fuel),
          0x41,
          0,
          0x4a,
          0x0d,
          0,
        );
        this.defaults();
        this.e(0x0f, 0x0b);
      } else {
        this.e(0x23, uleb(m.fuel), 0x41, 1, 0x48, 0x04, 0x40);
        this.defaults();
        this.e(0x0f, 0x0b);
        this.e(0x23, uleb(m.fuel), 0x41, sleb(1), 0x6b, 0x24, uleb(m.fuel));
      }
    }
    if (chance(0.25) && f.params[0] === I32) {
      // tests its first parameter first
      const k = int(3);
      if (k === 0) {
        this.e(0x20, 0, 0x04, 0x40);
        this.stmts(2, 3);
        this.e(0x0b);
      } else if (k === 1) {
        this.e(0x02, 0x40, 0x20, 0, 0x0d, 0);
        this.push("block", []);
        this.stmts(2, 3);
        this.labels.pop();
        this.e(0x0b);
      } else {
        this.e(0x20, 0, 0x45, 0x04, 0x40);
        this.stmts(2, 3);
        this.e(0x05);
        this.stmts(2, 3);
        this.e(0x0b);
      }
    }
    const usesStack = chance(0.35);
    let spLocal = -1;
    if (usesStack) {
      // push a frame in linear memory
      spLocal = this.locals.length;
      this.locals.push(I32);
      this.extra.push(I32);
      this.kept.add(spLocal);
      this.e(0x23, uleb(m.stackPointer), 0x41, sleb(pick([8, 16, 32, 48])), 0x6b, 0x22, uleb(spLocal));
      if (m.stackPointer !== m.fuel) this.e(0x24, uleb(m.stackPointer));
      else this.e(0x1a);
    }
    this.sp = spLocal;
    if (m.hasMemory)
      for (let i = int(3); i-- > 0;) {
        const p = this.locals.length;
        const t = chance(0.75) ? I32 : I64;
        this.locals.push(t);
        this.extra.push(t);
        this.kept.add(p);
        this.pointers.push(p);
        this.setPointer(p, 2);
      }
    this.stmts(m.style === "big" ? 6 : 4, (m.style === "big" ? 12 : 3) + int(6));
    if (usesStack && chance(0.85) && m.stackPointer !== m.fuel)
      this.e(0x20, uleb(spLocal), 0x41, sleb(pick([8, 16, 32, 48])), 0x6a, 0x24, uleb(m.stackPointer));
    if (m.hasMemory && chance(0.6)) {
      const n = this.locals.length;
      for (let i = 0; i < n && i < 40; i++) {
        if (chance(0.3)) continue;
        const t = this.locals[i];
        this.e(constant(I32, 0x4000 + this.index * 512 + i * 8), 0x20, uleb(i));
        if (t === F32 || t === F64) this.canon(t);
        this.e({ [I32]: 0x36, [I64]: 0x37, [F32]: 0x38, [F64]: 0x39 }[t], 0, 0);
      }
    }
    this.budget += 6;
    for (const r of f.results) this.expr(r, 4);
    this.e(0x0b);
    const groups = this.extra.map(t => [1, t]);
    return [...vec(groups), ...this.out];
  }
  defaults() {
    for (const r of this.f.results) this.e(constant(r, 0));
  }
  push(kind, types) {
    this.labels.push({ kind, types });
  }
  stmts(depth, n) {
    for (let i = 0; i < n; i++) this.stmt(depth);
  }
  block(body) {
    this.push("block", []);
    this.e(0x02, 0x40);
    body();
    this.labels.pop();
    this.e(0x0b);
  }
  stmt(depth) {
    if (this.budget-- <= 0 || depth <= 0) {
      this.simple();
      return;
    }
    const r = R() * 100;
    const m = this.m;
    if (r > 95.5 && m.hasMemory) this.storeRun(depth);
    else if (r < 4 && this.pointers.length) this.setPointer(pick(this.pointers), depth);
    else if (r < 22) this.setLocal(depth);
    else if (r < 31) this.setGlobal(depth);
    else if (r < 47) this.store(depth);
    else if (r < 57) {
      // if
      this.cond(depth - 1);
      this.e(0x04, 0x40);
      this.push("if", []);
      this.stmts(depth - 1, 1 + int(3));
      if (chance(0.45)) {
        this.e(0x05);
        this.stmts(depth - 1, 1 + int(3));
      }
      this.labels.pop();
      this.e(0x0b);
    } else if (r < 64)
      this.block(() => {
        this.stmts(depth - 1, 1 + int(2));
        if (chance(0.7)) {
          this.cond(depth - 1);
          this.e(0x0d, uleb(0));
        }
        this.stmts(depth - 1, 1 + int(2));
      });
    else if (r < 71) this.loop(depth);
    else if (r < 75) this.brTable(depth);
    else if (r < 78 && this.callsLeft > 0 && this.m.funcs.some(g => g.resumable)) {
      this.callsLeft--;
      const rs = this.m.funcs.map((g, x) => x).filter(x => this.m.funcs[x].resumable);
      if (chance(0.7)) this.e(constant(I32, 0));
      else this.expr(I32, 1);
      this.e(0x10, uleb(this.m.importCount + pick(rs)));
      const k = int(4);
      if (k === 0) {
        this.e(0x04, 0x40);
        this.push("if", []);
        this.stmts(depth - 1, 1 + int(2));
        if (chance(0.5)) {
          this.e(0x05);
          this.stmts(depth - 1, 1);
        }
        this.labels.pop();
        this.e(0x0b);
      } else if (k === 1) {
        this.e(0x45, 0x04, 0x40);
        this.push("if", []);
        this.stmts(depth - 1, 1 + int(2));
        this.labels.pop();
        this.e(0x0b);
      } else if (k === 2) {
        const l = this.localsOf(I32).filter(x => !this.kept.has(x));
        if (l.length) this.e(0x22, uleb(pick(l)));
        this.e(0x04, 0x40);
        this.push("if", []);
        this.stmts(depth - 1, 1);
        this.labels.pop();
        this.e(0x0b);
      } else this.e(0x1a);
    } else if (r < 83) this.call(depth, null);
    else if (r < 86) this.bulk(depth);
    else if (r < 87 && chance(0.5)) this.table(depth);
    else if (r < 91) {
      this.expr(pick([I32, I64, F64, F32]), depth - 1);
      this.e(0x1a);
    } else if (r < 92.5 && this.labels.length) {
      // conditional branch outward
      const void_ = this.labels.map((l, i) => (l.types.length || l.kind === "loop" ? -1 : i)).filter(i => i >= 0);
      if (void_.length) {
        this.cond(depth - 1);
        this.e(0x0d, uleb(this.labels.length - 1 - pick(void_)));
      }
    } else if (r < 94) {
      // early return in an arm
      this.cond(depth - 1);
      this.e(0x04, 0x40);
      this.push("if", []);
      if (chance(0.8)) {
        for (const t of this.f.results) this.expr(t, 1);
        this.e(0x0f);
      } else this.e(0x00);
      this.labels.pop();
      this.e(0x0b);
    } else if (r < 95 && m.hasMemory) {
      this.expr(I32, 1);
      this.e(0x41, 1, 0x71, 0x40, 0);
      this.e(0x1a);
    } else if (r < (m.style === "mixed" ? 98 : 96) && m.hasExceptions) {
      // try_table with catch
      this.e(0x02, I32, 0x1f, 0x40, 1, 0x00, 0, 0);
      this.push("block", [I32]);
      this.push("block", []);
      this.stmts(depth - 1, 2);
      this.cond(1);
      this.e(0x04, 0x40);
      this.expr2const();
      this.e(0x08, 0, 0x0b);
      this.labels.pop();
      this.e(0x0b);
      this.labels.pop();
      this.e(constant(I32, 5), 0x0b, 0x1a);
    } else if (r < 98) this.stackSlot(depth);
    else this.simple();
  }
  expr2const() {
    this.e(constant(I32, pick(I32S)));
  }
  stackSlot(depth) {
    if (this.sp < 0 || !this.m.hasMemory) return this.simple();
    const t = pick([I32, I64, F64]);
    if (chance(0.5)) {
      this.e(0x20, uleb(this.sp));
      this.sinkable(t, depth - 1);
      this.e({ [I32]: 0x36, [I64]: 0x37, [F64]: 0x39 }[t], 0, uleb(pick([0, 4, 8, 12, 24])));
    } else {
      const l = this.localsOf(t).filter(x => !this.kept.has(x));
      if (!l.length) return this.simple();
      this.e(
        0x20,
        uleb(this.sp),
        { [I32]: 0x28, [I64]: 0x29, [F64]: 0x2b }[t],
        0,
        uleb(pick([0, 4, 8, 12, 24])),
        0x21,
        uleb(pick(l)),
      );
    }
  }
  // stores of constants beside each other, behind an access that proves their addresses, with loads, sets, calls and traps in between
  storeRun(depth) {
    const ps = this.pointers.filter(p => this.locals[p] === I32);
    const useConst = !ps.length || chance(0.25);
    const p = useConst ? 0 : pick(ps),
      base = pick([0, 64, 1024, 65472]);
    const at = (): void => {
      if (useConst) this.e(constant(I32, base));
      else this.e(0x20, uleb(p));
    };
    if (chance(0.8)) {
      at();
      this.e(chance(0.5) ? [0x28, 0, ...uleb(48)] : [0x29, 0, ...uleb(56)], 0x1a);
    }
    for (let i = 3 + int(8); i-- > 0;) {
      const r = int(20),
        o = int(48);
      if (r < 12) {
        const [t, op, w] = pick([
          [I32, 0x36, 4],
          [I32, 0x36, 4],
          [I32, 0x36, 4],
          [I64, 0x37, 8],
          [I32, 0x3a, 1],
          [I32, 0x3b, 2],
          [I64, 0x3e, 4],
        ]);
        at();
        this.e(
          chance(0.85)
            ? t === I32
              ? constant(I32, pick([0, 0, 1, -1, 7, 0x12345678, -0x80000000, 255]))
              : constant(I64, pick([0n, 0n, 1n, -1n, 0x123456789abcdefn]))
            : this.localsOf(t).length
              ? [0x20, ...uleb(pick(this.localsOf(t)))]
              : constant(t, 3),
          op,
          0,
          uleb(o - (chance(0.8) || isAligned ? o % w : 0)),
        );
      } else if (r < 15) {
        const l = this.localsOf(I32).filter(x => !this.kept.has(x));
        if (l.length) {
          at();
          this.e(pick([0x28, 0x2d, 0x2f]), 0, uleb(o - (o % 4)), 0x21, uleb(pick(l)));
        }
      } else if (r < 16) {
        this.cond(1);
        this.e(0x04, 0x40);
        this.stmt(0);
        this.e(0x0b);
      } else if (r < 17 && this.callsLeft > 0) this.call(1, null);
      else if (r < 18 && !useConst && chance(0.4)) this.setPointer(p, 1);
      else if (r < 19) {
        this.cond(1);
        this.e(0x04, 0x40, chance(0.2) ? 0x00 : 0x01, 0x0b);
      } else {
        const l = this.localsOf(I64).filter(x => !this.kept.has(x));
        if (l.length) {
          at();
          this.e(0x29, 0, uleb(o - (o % 8)), 0x21, uleb(pick(l)));
        }
      }
    }
  }
  setPointer(p, depth) {
    if (this.locals[p] === I32) {
      this.expr(I32, depth - 1);
      this.e(constant(I32, pick(isAligned ? [0xfff8, 0xfff0, 0x7ff0] : [0xfff8, 0xfff0, 0xffff, 0x7ff0])), 0x71);
      if (chance(0.08))
        this.e(constant(I32, pick(isAligned ? [65504, 60000, -40, -8] : [65500, 60000, -40, -8])), 0x6a);
      this.e(0x21, uleb(p));
    } else {
      this.expr(I64, depth - 1);
      this.e(constant(I64, pick([0xfff8n, 0x7ff0n, 0xfffff0000fff0n, 0x7fffffff0000fff8n])), 0x83, 0x21, uleb(p));
    }
  }
  simple() {
    const t = pick([I32, I64, I32, F64]);
    const l = this.localsOf(t).filter(x => !this.kept.has(x));
    if (!l.length) {
      this.e(0x01);
      return;
    }
    this.leaf(t);
    this.e(0x21, uleb(pick(l)));
  }
  setLocal(depth) {
    const i = int(this.locals.length);
    if (this.kept.has(i)) return this.simple();
    this.expr(this.locals[i], depth - 1);
    this.e(0x21, uleb(i));
  }
  setGlobal(depth) {
    const choices = this.m.globals.map((g, i) => i).filter(i => this.m.globals[i].mutable && i !== this.m.fuel);
    if (!choices.length) return this.simple();
    const i = pick(choices);
    this.expr(this.m.globals[i].type, depth - 1);
    if (i === this.m.stackPointer && chance(0.95)) this.e(constant(I32, pick([0xfff0, 0x7ff0, 0xfe00])), 0x71);
    this.e(0x24, uleb(i));
  }
  // an address: mostly inside the memory, sometimes at its edges, sometimes anywhere. Leaves i32 on the stack and returns the offset to use.
  address(depth, size) {
    if (isAligned) {
      // no access straddles the end of the memory
      this.needsMask = true;
      const o = this.address_(depth, size);
      if (this.needsMask) this.e(constant(I32, -8), 0x71);
      return o - (o % 8);
    }
    return this.address_(depth, size);
  }
  address_(depth, size) {
    const wild = chance(0.02);
    const r = R() * 100;
    const safe = () => this.e(0x41, sleb(pick([0xfff8, 0xffff, 0x7ffc, 0xfff0])), 0x71);
    const offset = () =>
      wild
        ? pick([0, 8, 1000, 65528, 65536, 0x7ffffff8, 0xfffffff0, 0xffffffff, 0x10000000])
        : pick([0, 0, 0, 1, 4, 8, 12, 16, 24, 40, 100]);
    if (r < 30 && this.pointers.length) {
      const p = pick(this.pointers);
      this.e(0x20, uleb(p));
      const add = chance(0.4) ? (isAligned ? pick([8, 16, 24, 40, 104]) : pick([4, 8, 12, 16, 24, 40, 100])) : 0;
      this.needsMask = false;
      if (this.locals[p] === I32) {
        if (add) this.e(0x41, sleb(add), 0x6a);
        else if (chance(0.1)) this.e(0x41, sleb(-8), 0x6a, 0x41, sleb(0xffff), 0x71);
      } else {
        if (add) this.e(constant(I64, add), 0x7c);
        this.e(0xa7);
      }
      return offset();
    }
    if (r < 42) {
      this.expr(I32, depth - 1);
      if (!wild) safe();
      return offset();
    }
    if (r < 56) {
      this.e(
        constant(
          I32,
          wild
            ? pick([65520, 65528, 65532, 65535, 65536, 131064, 131072, -1, -4, -8, 0x7ffffffc, -0x80000000])
            : pick([0, 4, 8, 16, 1024, 4096, 30000, 65000]),
        ),
      );
      return offset();
    }
    if (r < 66) {
      const l = this.localsOf(I32);
      if (l.length) {
        this.e(0x20, uleb(pick(l)));
        if (!wild) safe();
        if (chance(0.35)) this.e(0x41, sleb(pick([4, 8, 12, 16, 24, 100])), 0x6a);
        return offset();
      }
    }
    if (r < 78) {
      this.e(0x23, uleb(this.m.stackPointer));
      if (this.m.stackPointer === this.m.fuel) safe();
      if (chance(0.4)) this.e(0x41, sleb(pick([-16, -8, 8, 16, 24])), 0x6a);
      return offset();
    }
    if (r < 84) {
      const g = this.globalsOf(I64);
      if (g.length) {
        this.e(0x23, uleb(pick(g)), 0xa7);
        if (!wild) safe();
        return offset();
      }
    }
    if (r < 90) {
      const l = this.localsOf(I64);
      if (l.length) {
        this.e(0x20, uleb(pick(l)));
        if (chance(0.4)) this.e(constant(I64, pick([4, 8, 16, 100])), 0x7c);
        this.e(0xa7);
        if (!wild) safe();
        return offset();
      }
    }
    if (r < 96) {
      this.expr(I32, depth - 1);
      this.e(0x41, 7, 0x71, 0x41, 3, 0x74);
      this.e(constant(I32, wild ? 65500 : pick([0, 1024, 4096, 60000])), 0x6a);
      return offset();
    }
    this.leaf(I32);
    safe();
    return offset();
  }
  store(depth) {
    if (!this.m.hasMemory) return this.setLocal(depth);
    const [t, op, size] = pick([
      [I32, 0x36, 4],
      [I32, 0x36, 4],
      [I64, 0x37, 8],
      [I64, 0x37, 8],
      [F32, 0x38, 4],
      [F64, 0x39, 8],
      [I32, 0x3a, 1],
      [I32, 0x3b, 2],
      [I64, 0x3c, 1],
      [I64, 0x3d, 2],
      [I64, 0x3e, 4],
    ]);
    const offset = this.address(depth, size);
    if (chance(0.25)) this.e(randomConstantNoNaN(t));
    else this.sinkable(t, depth - 1);
    this.e(op, 0, uleb(offset));
  }
  // a value whose bits are determined (no computed NaN)
  sinkable(t, depth) {
    this.expr(t, depth);
    if (t === F32 || t === F64) this.canon(t);
  }
  canon(t) {
    const l = this.locals.length;
    this.locals.push(t);
    this.extra.push(t);
    const [eq, c] = t === F32 ? [0x5b, constant(F32, 7)] : [0x61, constant(F64, 7)];
    this.e(0x22, uleb(l), c, 0x20, uleb(l), 0x20, uleb(l), eq, 0x1b);
  }
  cond(depth) {
    if (depth <= 0) {
      this.leaf(I32);
      return;
    }
    const r = R() * 100;
    if (r < 30) {
      const t = pick([I32, I64]);
      this.expr(t, depth - 1);
      if (chance(0.4)) this.e(randomConstant(t));
      else this.expr(t, depth - 1);
      this.e((t === I32 ? 0x46 : 0x51) + int(10));
    } else if (r < 45 && this.m.hasMemory) {
      // a comparison with memory
      const [t, op, first] = pick([
        [I32, 0x28, 0x46],
        [I64, 0x29, 0x51],
        [I32, 0x2d, 0x46],
        [I32, 0x2f, 0x46],
        [I32, 0x2c, 0x46],
        [I64, 0x35, 0x51],
        [I64, 0x34, 0x51],
        [I64, 0x31, 0x51],
      ]);
      const load = () => {
        const o = this.address(depth, 8);
        this.e(op, 0, uleb(o));
      };
      const other = () => (chance(0.5) ? this.e(randomConstant(t)) : this.expr(t, depth - 1));
      if (chance(0.5)) {
        load();
        other();
      } else {
        other();
        load();
      }
      this.e(first + int(10));
    } else if (r < 52) {
      this.expr(I64, depth - 1);
      this.e(0x50);
    } else if (r < 58) {
      this.expr(I32, depth - 1);
      this.e(0x45);
      for (let i = int(3); i-- > 0;) this.e(chance(0.5) ? [0xad, 0x50] : 0x45);
    } else if (r < 65) {
      // comparison of an extended word
      this.expr(I32, depth - 1);
      this.e(pick([0xac, 0xad]));
      if (chance(0.6)) this.e(constant(I64, pick(I64S)));
      else {
        this.expr(I32, depth - 1);
        this.e(pick([0xac, 0xad]));
      }
      this.e(0x51 + int(10));
    } else if (r < 72) {
      const t = pick([F32, F64]);
      this.expr(t, depth - 1);
      this.expr(t, depth - 1);
      this.e((t === F32 ? 0x5b : 0x61) + int(6));
    } else if (r < 80) {
      this.expr(I32, depth - 1);
      this.e(constant(I32, pick([1, 2, 4, 128, 255, 0x8000, -0x80000000])), 0x71);
    } else this.expr(I32, depth - 1);
  }
  loop(depth) {
    if (this.loopDepth >= 2) return this.setLocal(depth);
    // a counter local of its own
    const saved = this.counter;
    const c = this.locals.length;
    this.locals.push(I32);
    this.extra.push(I32);
    this.kept.add(c);
    this.counter = c;
    this.loopDepth++;
    this.e(constant(I32, 1 + int(6)), 0x21, uleb(c));
    const form = int(3);
    if (form === 0) {
      this.e(0x03, 0x40);
      this.push("loop", []);
      this.stmts(depth - 1, 1 + int(3));
      this.e(0x20, uleb(c), 0x41, 1, 0x6b, 0x22, uleb(c), 0x0d, 0);
      this.labels.pop();
      this.e(0x0b);
    } else if (form === 1) {
      this.e(0x02, 0x40);
      this.push("block", []);
      this.e(0x03, 0x40);
      this.push("loop", []);
      this.e(0x20, uleb(c), 0x45, 0x0d, 1, 0x20, uleb(c), 0x41, sleb(-1), 0x6a, 0x21, uleb(c));
      this.stmts(depth - 1, 1 + int(3));
      if (chance(0.4)) {
        this.cond(depth - 1);
        this.e(0x0d, 0);
        this.stmts(depth - 1, 1);
      }
      if (chance(0.2)) {
        this.cond(depth - 1);
        this.e(0x0d, 1);
      }
      this.e(0x0c, 0);
      this.labels.pop();
      this.e(0x0b);
      this.labels.pop();
      this.e(0x0b);
    } else {
      // a state machine
      const s = this.locals.length;
      this.locals.push(I32);
      this.extra.push(I32);
      this.kept.add(s);
      const n = 2 + int(3);
      this.e(constant(I32, chance(0.7) ? 0 : int(n + 1)), 0x21, uleb(s));
      this.e(0x02, 0x40);
      this.push("block", []);
      this.e(0x03, 0x40);
      this.push("loop", []);
      const early = chance(0.3);
      if (early) this.e(0x20, uleb(c), 0x45, 0x0d, 1);
      for (let i = 0; i < n; i++) {
        this.e(0x02, 0x40);
        this.push("block", []);
      }
      this.e(0x20, uleb(s), 0x0e, vec(Array.from({ length: n - 1 }, (_, i) => uleb(i))), uleb(n - 1));
      for (let i = 0; i < n; i++) {
        this.labels.pop();
        this.e(0x0b);
        this.e(0x20, uleb(c), 0x41, 1, 0x6b, 0x22, uleb(c), 0x41, 0, 0x4c, 0x0d, uleb(n - i));
        this.stmts(depth - 1, 1 + int(2));
        const next = int(n + 2);
        const back = n - 1 - i;
        if (chance(0.25)) {
          this.cond(depth - 1);
          this.e(0x04, 0x40, constant(I32, int(n)), 0x21, uleb(s), 0x0c, uleb(back + 1), 0x0b);
        }
        if (i < n - 1 ? chance(0.6) : true) {
          if (chance(0.85)) this.e(constant(I32, next), 0x21, uleb(s));
          else {
            this.expr(I32, depth - 1);
            this.e(constant(I32, 3), 0x71, 0x21, uleb(s));
          }
          if (chance(0.2)) {
            this.cond(1);
            this.e(0x0d, uleb(back));
          } else this.e(0x0c, uleb(back));
          if (i === n - 1) this.lastWasBr = true;
        }
      }
      this.labels.pop();
      this.e(0x0b);
      this.labels.pop();
      this.e(0x0b);
    }
    this.loopDepth--;
    this.counter = saved;
  }
  brTable(depth) {
    const n = 2 + int(4);
    for (let i = 0; i <= n; i++) {
      this.e(0x02, 0x40);
      this.push("block", []);
    }
    this.expr(I32, depth - 1);
    if (chance(0.7)) this.e(constant(I32, 7), 0x71);
    this.e(0x0e, vec(Array.from({ length: n }, () => uleb(int(n + 1)))), uleb(int(n + 1)));
    for (let i = 0; i <= n; i++) {
      this.labels.pop();
      this.e(0x0b);
      if (i < n) {
        this.stmts(depth - 1, 1 + int(2));
        if (chance(0.6)) this.e(0x0c, uleb(n - 1 - i));
      }
    }
  }
  bulk(depth) {
    if (!this.m.hasMemory) return this.setLocal(depth);
    const small = () => {
      this.expr(I32, 1);
      this.e(0x41, sleb(0x7fff), 0x71);
    };
    const any = () =>
      chance(0.95)
        ? small()
        : chance(0.5)
          ? this.e(constant(I32, pick([0, 1, 65535, 65536, 65537, -1, -8, 131072])))
          : this.expr(I32, 1);
    const len = () => (chance(0.96) ? (this.expr(I32, 1), this.e(0x41, sleb(0x3f), 0x71)) : any());
    const k = int(3);
    if (k === 0) {
      any();
      this.expr(I32, 1);
      len();
      this.e(0xfc, 11, 0);
    } else if (k === 1) {
      any();
      any();
      len();
      this.e(0xfc, 10, 0, 0);
    } else if (this.m.passive >= 0) {
      if (chance(0.1)) this.e(0xfc, 9, uleb(this.m.passive));
      else {
        any();
        this.expr(I32, 1);
        this.e(0x41, sleb(63), 0x71);
        this.expr(I32, 1);
        this.e(0x41, sleb(31), 0x71);
        this.e(0xfc, 8, uleb(this.m.passive), 0);
      }
    } else this.simple();
  }
  table(depth) {
    const k = int(5);
    const idx = () => {
      this.expr(I32, 1);
      if (chance(0.85)) this.e(0x41, 7, 0x71);
    };
    if (k === 0) {
      idx();
      idx();
      this.e(0x25, 0, 0x26, 0);
    } // table.set(i, table.get(j))
    else if (k === 1) {
      idx();
      this.e(0x25, 0, 0xd1, 0x1a);
    } else if (k === 2) {
      this.e(0xd0, FUNCREF);
      this.expr(I32, 1);
      this.e(0x41, 1, 0x71, 0xfc, 15, 0, 0x1a);
    } else if (k === 3) {
      idx();
      idx();
      this.expr(I32, 1);
      this.e(0x41, 3, 0x71, 0xfc, 14, 0, 0);
    } else {
      this.e(0xfc, 16, 0, 0x1a);
    }
  }
  call(depth, want) {
    if (this.callsLeft <= 0 || (this.loopDepth >= 2 && chance(0.7))) {
      if (want !== null) {
        this.leaf(want);
        return;
      }
      return this.setLocal(depth);
    }
    this.callsLeft--;
    const m = this.m;
    const all: any[] = [];
    m.imports.forEach((f, i) => all.push({ f, i, imported: true }));
    m.funcs.forEach((f, i) => all.push({ f, i: i + m.imports.length, own: i }));
    let candidates = all.filter(c => want === null || (c.f.results.length === 1 && c.f.results[0] === want));
    if (!candidates.length) {
      if (want !== null) {
        this.leaf(want);
        return;
      }
      return this.simple();
    }
    const c = pick(candidates);
    const indirect = chance(0.3);
    c.f.params.forEach((t, i) => {
      if (i === 0 && t === I32 && chance(0.35)) this.e(constant(I32, 0));
      else if (chance(0.3)) this.e(randomConstant(t));
      else this.expr(t, depth - 2);
    });
    if (indirect) {
      const good = m.elements.map((x, i) => (m.sameSignature(x, c.f) ? i : -1)).filter(i => i >= 0);
      if (good.length && chance(0.96)) this.e(constant(I32, pick(good)));
      else if (chance(0.2)) {
        this.expr(I32, 1);
        this.e(0x41, 7, 0x71);
      } else {
        c.f.params.forEach(() => this.e(0x1a));
        this.e(...c.f.results.map(t => constant(t, 1)));
        if (want === null) c.f.results.forEach(() => this.e(0x1a));
        return;
      }
      this.e(0x11, uleb(m.type(c.f.params, c.f.results)), 0);
    } else if (
      m.hasTailCalls &&
      want === null &&
      String(c.f.results) === String(this.f.results) &&
      this.labels.length === 0 &&
      chance(0.4)
    ) {
      this.e(0x12, uleb(c.i));
      if (this.labels.length === 0) {
        return;
      }
      return;
    } else this.e(0x10, uleb(c.i));
    if (want === null) {
      for (let i = c.f.results.length; i-- > 0;) {
        const l = this.localsOf(c.f.results[i]).filter(x => !this.kept.has(x));
        if (l.length && chance(0.7)) this.e(0x21, uleb(pick(l)));
        else this.e(0x1a);
      }
    }
  }
  leaf(t) {
    const l = this.localsOf(t),
      g = this.globalsOf(t);
    const r = R();
    if (r < 0.6 && l.length) this.e(0x20, uleb(pick(l)));
    else if (r < 0.75 && g.length) this.e(0x23, uleb(pick(g)));
    else this.e(randomConstant(t));
  }
  expr(t, depth) {
    if (depth <= 0 || this.budget-- <= 0) return this.leaf(t);
    const m = this.m;
    const r = R() * 100;
    if (r < 12) return this.leaf(t);
    if (r < 17) {
      const l = this.localsOf(t).filter(x => !this.kept.has(x));
      if (l.length) {
        this.expr(t, depth - 1);
        this.e(0x22, uleb(pick(l)));
        return;
      }
    }
    if (r < 22) {
      this.expr(t, depth - 1);
      this.expr(t, depth - 1);
      this.cond(depth - 1);
      this.e(0x1b);
      return;
    }
    if (r < 26) {
      // if expression
      this.cond(depth - 1);
      this.e(0x04, t);
      this.push("if", [t]);
      if (chance(0.3)) this.stmt(depth - 2);
      this.expr(t, depth - 1);
      this.e(0x05);
      if (chance(0.3)) this.stmt(depth - 2);
      this.expr(t, depth - 1);
      this.labels.pop();
      this.e(0x0b);
      return;
    }
    if (r < 29) {
      // block with a branch that carries a value
      this.e(0x02, t);
      this.push("block", [t]);
      this.expr(t, depth - 1);
      this.cond(depth - 1);
      this.e(0x0d, 0, 0x1a);
      if (chance(0.5)) this.stmt(depth - 2);
      this.expr(t, depth - 1);
      this.labels.pop();
      this.e(0x0b);
      return;
    }
    if (r < 33) return this.call(depth, t);
    if (r < 48 && m.hasMemory) {
      const ops = {
        [I32]: [
          [0x28, 4],
          [0x28, 4],
          [0x2c, 1],
          [0x2d, 1],
          [0x2e, 2],
          [0x2f, 2],
        ],
        [I64]: [
          [0x29, 8],
          [0x29, 8],
          [0x30, 1],
          [0x31, 1],
          [0x32, 2],
          [0x33, 2],
          [0x34, 4],
          [0x35, 4],
        ],
        [F32]: [[0x2a, 4]],
        [F64]: [[0x2b, 8]],
      }[t];
      const [op, size] = pick(ops);
      const o = this.address(depth, size);
      this.e(op, 0, uleb(o));
      return;
    }
    switch (t) {
      case I32: {
        const k = int(22);
        if (k < 10) {
          this.expr(I32, depth - 1);
          if (chance(0.4)) this.e(randomConstant(I32));
          else this.expr(I32, depth - 1);
          this.e(pick([0x6a, 0x6b, 0x6c, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x6a, 0x6b]));
        } else if (k < 12) {
          this.expr(I32, depth - 1);
          if (chance(0.6)) this.e(constant(I32, pick([1, 2, 3, 5, 7, 10, 16, 100, -1, -3, 0x7fffffff, -0x80000000])));
          else {
            this.expr(I32, depth - 1);
            if (chance(0.9)) this.e(0x41, 1, 0x72);
          }
          this.e(0x6d + int(4));
        } else if (k < 14) {
          this.expr(I32, depth - 1);
          this.e(pick([0x67, 0x68, 0x69, 0x45, 0xc0, 0xc1]));
        } else if (k < 16) {
          this.expr(I64, depth - 1);
          this.e(0xa7);
        } else if (k < 17) {
          const f = pick([F32, F64]);
          this.expr(f, depth - 1);
          if (chance(0.97)) this.e(0xfc, f === F32 ? int(2) : 2 + int(2));
          else this.e(f === F32 ? 0xa8 + int(2) : 0xaa + int(2));
        } else if (k < 18) {
          this.sinkable(F32, depth - 1);
          this.e(0xbc);
        } else if (k < 19 && m.hasMemory) this.e(0x3f, 0);
        else this.cond(depth);
        return;
      }
      case I64: {
        const k = int(20);
        if (k < 9) {
          this.expr(I64, depth - 1);
          if (chance(0.4)) this.e(randomConstant(I64));
          else this.expr(I64, depth - 1);
          this.e(pick([0x7c, 0x7d, 0x7e, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x7c, 0x7d]));
        } else if (k < 11) {
          this.expr(I64, depth - 1);
          if (chance(0.5))
            this.e(constant(I64, pick([1n, 2n, 3n, 7n, 10n, 16n, -1n, -3n, 0x100000000n, -0x8000000000000000n])));
          else {
            this.expr(I64, depth - 1);
            if (chance(0.9)) this.e(0x42, 1, 0x84);
          }
          this.e(0x7f + int(4));
        } else if (k < 13) {
          this.expr(I64, depth - 1);
          this.e(pick([0x79, 0x7a, 0x7b, 0xc2, 0xc3, 0xc4]));
        } else if (k < 17) {
          this.expr(I32, depth - 1);
          this.e(pick([0xac, 0xad]));
        } else if (k < 18) {
          const f = pick([F32, F64]);
          this.expr(f, depth - 1);
          if (chance(0.97)) this.e(0xfc, f === F32 ? 4 + int(2) : 6 + int(2));
          else this.e(f === F32 ? 0xae + int(2) : 0xb0 + int(2));
        } else if (k < 19) {
          this.sinkable(F64, depth - 1);
          this.e(0xbd);
        } else {
          this.cond(depth);
          this.e(0xad);
        }
        return;
      }
      case F32: {
        const k = int(10);
        if (k < 5) {
          this.expr(F32, depth - 1);
          this.expr(F32, depth - 1);
          this.e(pick([0x92, 0x93, 0x94, 0x95, 0x96, 0x97]));
        } else if (k < 6) {
          this.expr(F32, depth - 1);
          this.sinkable(F32, depth - 1);
          this.e(0x98);
        } else if (k < 7) {
          this.expr(F32, depth - 1);
          this.e(0x8b + int(7));
        } else if (k < 8) {
          const i = pick([I32, I64]);
          this.expr(i, depth - 1);
          this.e((i === I32 ? 0xb2 : 0xb4) + int(2));
        } else if (k < 9) {
          this.expr(F64, depth - 1);
          this.e(0xb6);
        } else {
          this.expr(I32, depth - 1);
          this.e(0xbe);
        }
        return;
      }
      case F64: {
        const k = int(10);
        if (k < 5) {
          this.expr(F64, depth - 1);
          this.expr(F64, depth - 1);
          this.e(pick([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]));
        } else if (k < 6) {
          this.expr(F64, depth - 1);
          this.sinkable(F64, depth - 1);
          this.e(0xa6);
        } else if (k < 7) {
          this.expr(F64, depth - 1);
          this.e(0x99 + int(7));
        } else if (k < 8) {
          const i = pick([I32, I64]);
          this.expr(i, depth - 1);
          this.e((i === I32 ? 0xb7 : 0xb9) + int(2));
        } else if (k < 9) {
          this.expr(F32, depth - 1);
          this.e(0xbb);
        } else {
          this.expr(I64, depth - 1);
          this.e(0xbf);
        }
        return;
      }
    }
  }
}
const randomConstantNoNaN = t => {
  for (;;) {
    const c = randomConstant(t);
    if (t === F32 && Number.isNaN(new Float32Array(new Uint8Array(c.slice(1)).buffer)[0])) continue;
    if (t === F64 && Number.isNaN(new Float64Array(new Uint8Array(c.slice(1)).buffer)[0])) continue;
    return c;
  }
};

// Runs every function of a module and prints what it returns or throws, the globals, a digest of the memory and what the imports saw.
export const driver = `const I32 = 0x7f, I64 = 0x7e, F32 = 0x7d, F64 = 0x7c;
const ints = [0, 1, -1, 8, 255, 4096, 65528, 65536, 0x7fffffff, -0x80000000, 12345678, 3];
const longs = [0n, 1n, -1n, 8n, 4096n, 0x7fffffffn, 0x80000000n, 0x100001000n, -0x8000000000000000n, 0x7fffffffffffffffn, 65528n, 0x123456789abcdefn];
const numbers = [0, -0, 1, -1.5, 2147483648, -2147483649, 4294967296, 1e300, NaN, Infinity, 5e-324, 3.25];
function run(index: number, module: WebAssembly.Module, info: any): void {
  let budget = 0;
  let counter = 0;
  let trace = 0;
  let depth = 0;
  let a: any, b: any;
  const note = (v: any): void => { trace = (Math.imul(trace, 31) + (typeof v === "bigint" ? Number(BigInt.asIntN(32, v)) ^ Number(BigInt.asIntN(32, v >> 32n)) : Number.isNaN(v) ? 7 : v === Infinity ? 8 : v === -Infinity ? 9 : Object.is(v, -0) ? 10 : (v | 0) ^ ((v * 1024) | 0))) | 0; };
  const acts: (() => void)[] = [
    () => {},
    () => { if (a.memory) new Uint32Array(a.memory.buffer)[(counter * 37) & 0x3fff] ^= counter * 2654435761; },
    () => { if (a.memory && counter % 5 === 0) { try { note(a.memory.grow(1)); } catch { note(1); } } },
    () => { if (depth < 2) { depth++; try { for (const n of ["f" + (counter % info.funcs.length)]) { const f = a[n]; const p = info.funcs[+n.slice(1)][0]; const r = f(...p.map((t: any, i: number) => arg(t, counter + i))); say1(r); } } catch (e: any) { note(2); if (counter % 7 === 0) { depth--; throw e; } } depth--; } },
    () => { const i = counter % info.globals.length; if (info.globals[i][1] && i !== info.fuel) a["set" + i](arg(info.globals[i][0], counter)); },
    () => { if (counter % 3 === 0) throw new Error("thrown by an import"); },
    () => { a.table.set(counter & 7, counter & 8 ? a["f" + (counter % info.funcs.length)] : b["f" + (counter % info.funcs.length)]); },
    () => { if (depth < 2 && counter % 2) { depth++; try { say1(b["get" + (counter % info.globals.length)]()); const n = counter % info.funcs.length; say1(b["f" + n](...info.funcs[n][0].map((t: any, i: number) => arg(t, counter + i)))); } catch { note(3); } depth--; } },
  ];
  const say1 = (r: any): void => { if (r === undefined) return; if (Array.isArray(r)) r.forEach(note); else note(r); };
  const act = (): void => { counter++; if (--budget > 0) acts[(counter * 7 + index) % acts.length](); };
  const imports = {
    h0: (x: any): any => { note(x); act(); return (x * 3 + counter) | 0; },
    h1: (x: any, y: any): any => { note(x); note(y); act(); return y ^ BigInt(counter); },
    h2: (x: any, y: any): any => { note(x); note(y); act(); return x - 1; },
    h3: () => { act(); },
    h4: (x: any): any => { note(x); act(); return [x ^ 5, BigInt(x) * 3n]; },
    h5: (...all: any[]): any => { all.forEach(note); act(); return all.length + counter; },
  };
  const arg = (t: number, i: number): any => (t === I32 ? ints[(i * 5) % ints.length] : t === I64 ? longs[(i * 5) % longs.length] : numbers[(i * 5) % numbers.length]);
  const make = (): any => {
    const env: any = { ...imports };
    if (info.memory) env.memory = new WebAssembly.Memory({ initial: info.memory.min, maximum: info.memory.max, shared: info.memory.shared });
    const e = new WebAssembly.Instance(module, { env }).exports;
    return e;
  };
  const show = (v: any): string => (Array.isArray(v) ? "[" + v.map(show).join(",") + "]" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : String(v));
  const hash = (e: any): number => {
    if (!e.memory) return 0;
    const w = new Uint32Array(e.memory.buffer);
    let h = w.length | 0;
    for (let i = 0; i < w.length; i++) if (w[i]) h = (Math.imul(h ^ w[i], 0x01000193) + i) | 0;
    return h;
  };
  const state = (e: any): string => info.globals.map((g: any, i: number) => show(e["get" + i]())).join(" ") + " mem " + hash(e);
  a = make();
  b = make();
  for (let round = 0; round < 2; round++) {
    for (let f = 0; f < info.funcs.length; f++) {
      const params = info.funcs[f][0];
      const rows = params.length ? 5 : 2;
      for (let row = 0; row < rows; row++) {
        const args = params.map((t: any, i: number) => arg(t, row + i * 3 + f + round * 2));
        const e = row === 4 ? b : a;
        if (info.sp !== undefined) { a["set" + info.sp](info.spInit); b["set" + info.sp](info.spInit); }
        e["set" + info.fuel](60); (e === a ? b : a)["set" + info.fuel](60);
        budget = 40;
        let outcome;
        try { outcome = show(e["f" + f](...args)); }
        catch (error: any) { outcome = "!" + String(error.message).replace(/ \\(evaluating .*/s, "").split(" ").map(word => word[0]).join(""); }
        console.log(\`m\${index} r\${round} f\${f}(\${args.map(show)})\${e === b ? " b" : ""} = \${outcome}; \${state(a)}; \${e === b ? \` b \${state(b)}; \` : ''} trace \${trace} \${counter}\`);
      }
    }
    console.log(\`m\${index} r\${round} b \${state(b)}\`);
    if (round === 0) { for (let i = 0; i < 8; i += 2) { try { a.table.set(i, b["f" + (i % info.funcs.length)]); } catch {} } }
  }
}
`;

export const encodings: readonly ((bytes: Uint8Array) => string)[] = [
  bytes => `(Uint8Array as any).fromBase64("${bytes.toBase64()}")`,
  bytes => `Buffer.from("${bytes.toBase64()}", "base64")`,
  bytes => `Buffer.from("${bytes.toHex()}", "hex")`,
  bytes => `Uint8Array.from(atob("${bytes.toBase64()}"), c => c.charCodeAt(0))`,
  bytes => `new Uint8Array([${bytes.join(", ")}])`,
];

export function generate(random: Random): string {
  R = () => random.next() / 4294967296;
  isAligned = chance(0.5);
  const style = random.weighted([
    [12, "plain"],
    [2, "small"],
    [2, "big"],
    [3, "mixed"],
  ] as const);
  const text = [driver];
  for (let k = 0, n = random.between(1, 2); k < n; k++) {
    for (let tries = 0; tries < 20; tries++) {
      const m = new Module(style);
      const bytes = m.bytes();
      if (!WebAssembly.validate(bytes)) continue;
      const info = {
        funcs: m.funcs.map((f: any) => [f.params, f.results]),
        globals: m.globals.map((g: any) => [g.type, g.mutable ? 1 : 0]),
        fuel: m.fuel,
        sp: m.stackPointer,
        spInit: m.spInit,
        memory: m.memoryImported
          ? { min: m.memMin, max: m.hasMax || m.shared ? m.memMax : undefined, shared: m.shared }
          : null,
      };
      text.push(`run(${k}, new WebAssembly.Module(${random.pick(encodings)(bytes)}), ${JSON.stringify(info)});`);
      break;
    }
  }
  return text.join("\n");
}
