// WebAssembly loops over memory: they end at a count, at an address, at a value or by a trap, read and write near addresses under several widths, and convert numbers in long chains
import type { Random } from "./random";
import { encodings } from "./webassembly-modules";

let R: () => number;
const int = (n: number) => Math.floor(R() * n);
const pick = (items: readonly any[]): any => items[int(items.length)];
const chance = (p: number) => R() < p;

const I32 = 0x7f,
  I64 = 0x7e,
  F32 = 0x7d,
  F64 = 0x7c;
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
const c32 = v => [0x41, ...sleb(v)],
  c64 = v => [0x42, ...sleb(v)],
  cf32 = v => [0x43, ...new Uint8Array(new Float32Array([v]).buffer)],
  cf64 = v => [0x44, ...new Uint8Array(new Float64Array([v]).buffer)];
const longs = [
  0n,
  1n,
  -1n,
  2n,
  255n,
  0x100000000n,
  0x1000001000000001n,
  0x20000000000001n,
  -0x20000000000001n,
  0x7fffffffffffffffn,
  -0x8000000000000000n,
  0x7fffff4000000001n,
  0x1000000n,
  0x1000001n,
];
const floats = [0, 1, -1, 0.5, 1.5, 2.5, -0, 16777217, 2147483648, -2147483649, 4294967296, 1e30, 1e-45, 3.4e38, 1e300, 5e-324, Infinity]; // prettier-ignore
const constant = t =>
  t === I32
    ? c32(pick([0, 1, 2, 3, 4, 7, 8, 31, 255, 256, -1, -2, 65535, 0x7fffffff, -0x80000000, 0x01020304]))
    : t === I64
      ? c64(pick(longs))
      : t === F32
        ? cf32(pick(floats))
        : cf64(pick(floats));

// [opcode, type, width]
const loads: [number, number, number][] = [
  [0x28, I32, 4],
  [0x2c, I32, 1],
  [0x2d, I32, 1],
  [0x2e, I32, 2],
  [0x2f, I32, 2],
  [0x29, I64, 8],
  [0x30, I64, 1],
  [0x31, I64, 1],
  [0x32, I64, 2],
  [0x33, I64, 2],
  [0x34, I64, 4],
  [0x35, I64, 4],
  [0x2a, F32, 4],
  [0x2b, F64, 8], // prettier-ignore
];
const stores: [number, number, number][] = [
  [0x36, I32, 4],
  [0x36, I32, 4],
  [0x3a, I32, 1],
  [0x3b, I32, 2],
  [0x37, I64, 8],
  [0x3c, I64, 1],
  [0x3d, I64, 2],
  [0x3e, I64, 4],
  [0x38, F32, 4],
  [0x39, F64, 8], // prettier-ignore
];
// [opcode, from, to]: what makes one number out of one other.
const conversions: [number[], number, number][] = [
  [[0xa7], I64, I32],
  [[0xac], I32, I64],
  [[0xad], I32, I64],
  [[0xb2], I32, F32],
  [[0xb3], I32, F32],
  [[0xb4], I64, F32],
  [[0xb5], I64, F32],
  [[0xb6], F64, F32],
  [[0xb6], F64, F32],
  [[0xb7], I32, F64],
  [[0xb8], I32, F64],
  [[0xb9], I64, F64],
  [[0xb9], I64, F64],
  [[0xba], I64, F64],
  [[0xbb], F32, F64],
  [[0xbb], F32, F64], // prettier-ignore
  [[0xbe], I32, F32],
  [[0xbf], I64, F64],
  [[0xc0], I32, I32],
  [[0xc1], I32, I32],
  [[0xc2], I64, I64],
  [[0xc3], I64, I64],
  [[0xc4], I64, I64],
  [[0xfc, 0], F32, I32],
  [[0xfc, 1], F32, I32],
  [[0xfc, 2], F64, I32],
  [[0xfc, 3], F64, I32],
  [[0xfc, 4], F32, I64],
  [[0xfc, 5], F32, I64],
  [[0xfc, 6], F64, I64],
  [[0xfc, 7], F64, I64], // prettier-ignore
  [[0x67], I32, I32],
  [[0x68], I32, I32],
  [[0x69], I32, I32],
  [[0x79], I64, I64],
  [[0x7a], I64, I64],
  [[0x7b], I64, I64],
  [[0x45], I32, I32],
  [[0x50], I64, I32], // prettier-ignore
  [[0x8b], F32, F32],
  [[0x8c], F32, F32],
  [[0x8d], F32, F32],
  [[0x8f], F32, F32],
  [[0x90], F32, F32],
  [[0x91], F32, F32],
  [[0x99], F64, F64],
  [[0x9a], F64, F64],
  [[0x9b], F64, F64],
  [[0x9d], F64, F64],
  [[0x9e], F64, F64],
  [[0x9f], F64, F64], // prettier-ignore
];
const binary = {
  [I32]: [
    0x6a, 0x6a, 0x6b, 0x6c, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x6d, 0x6e, 0x6f, 0x70, 0x46, 0x48, 0x49,
    0x4c,
  ],
  [I64]: [0x7c, 0x7c, 0x7d, 0x7e, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x7f, 0x80, 0x81, 0x82],
  [F32]: [0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98],
  [F64]: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6],
};

class Body {
  [name: string]: any;

  constructor(params: number[], result: number, helpers: number) {
    this.params = params;
    this.result = result;
    this.helpers = helpers;
    this.locals = [...params];
    this.extra = [];
    this.out = [];
    this.pointers = [0];
    for (const t of [I32, I64, F32, F64, pick([I32, I64, F32, F64])]) if (chance(0.75)) this.temp(t);
    this.acc = this.temp(result);
    this.budget = 60;
  }
  temp(t) {
    this.locals.push(t);
    this.extra.push(t);
    return this.locals.length - 1;
  }
  e(...b: any[]): void {
    for (const x of b)
      if (Array.isArray(x)) this.out.push(...x);
      else this.out.push(x);
  }
  of(t) {
    const r: number[] = [];
    this.locals.forEach(
      (x, i) => x === t && !this.pointers.includes(i) && i !== this.counter && i !== this.end && r.push(i),
    );
    return r;
  }
  address() {
    this.e(0x20, uleb(pick(this.pointers)));
    if (chance(0.12)) this.e(c32(pick([4, 8, -4, 1, 16])), 0x6a);
  }
  memarg(width) {
    return [
      pick([0, 0, 1, 2, 3].filter(x => 1 << x <= width)),
      ...uleb(this.near ?? pick([0, 0, 0, 1, 2, 3, 4, 8, 12])),
    ];
  }
  load(t) {
    const [op, , width] = pick(loads.filter(x => x[1] === t));
    this.address();
    this.e(op, this.memarg(width));
  }
  /** A float that is never NaN: the bits of a NaN are up to the engine. */
  settled(t) {
    if (t !== F32 && t !== F64) return;
    const i = this.temp(t);
    this.e(0x22, uleb(i), constant(t), 0x20, uleb(i), 0x20, uleb(i), t === F32 ? 0x5b : 0x61, 0x1b);
  }
  expr(t, depth) {
    if (depth <= 0 || this.budget-- <= 0) {
      const l = this.of(t);
      if (l.length && chance(0.6)) this.e(0x20, uleb(pick(l)));
      else this.e(constant(t));
      return;
    }
    const r = int(100);
    if (r < 18) this.load(t);
    else if (r < 58) {
      const [op, from] = pick(conversions.filter(x => x[2] === t));
      this.expr(from, depth - 1);
      this.e(op);
    } else if (r < 88) {
      const op = pick(binary[t]);
      this.expr(t, depth - 1);
      if (t === I32 && op >= 0x6d && op <= 0x70) this.e(c32(pick([1, 2, 3, 7, -3, 10])));
      else if (t === I64 && op >= 0x7f && op <= 0x82) this.e(c64(pick([1n, 2n, 3n, 10n, -7n])));
      else this.expr(t, depth - 1);
      // copysign() reads the sign of its second operand, and that of a NaN is up to the engine.
      if ((t === F32 && op === 0x98) || (t === F64 && op === 0xa6)) this.settled(t);
      this.e(op);
    } else if (r < 92) {
      this.expr(t, depth - 1);
      this.expr(t, depth - 1);
      this.expr(I32, 1);
      this.e(0x1b);
    } else if (r < 95 && this.helpers && t === I32) {
      this.expr(I32, 1);
      this.e(0x10, uleb(0));
    } else this.expr(t, 0);
  }
  store() {
    const [op, t, width] = pick(stores);
    this.address();
    if (chance(0.45)) this.e(constant(t));
    else {
      this.expr(t, 2);
      this.settled(t);
    }
    this.e(op, this.memarg(width));
  }
  set() {
    const t = pick([I32, I64, F32, F64]);
    const l = this.of(t);
    if (!l.length) return this.store();
    this.expr(t, 3);
    this.settled(t);
    this.e(0x21, uleb(pick(l)));
  }
  add() {
    this.e(0x20, uleb(this.acc));
    this.expr(this.result, 2);
    this.settled(this.result);
    this.e({ [I32]: 0x6a, [I64]: 0x7c, [F32]: 0x92, [F64]: 0xa0 }[this.result]);
    this.settled(this.result);
    this.e(0x21, uleb(this.acc));
  }
  statement(depth) {
    const r = int(100);
    if (r < 50) {
      // Near accesses share one offset now and then.
      this.near = chance(0.5) ? pick([0, 0, 4, 8]) : undefined;
      this.store();
      if (chance(0.5)) {
        if (chance(0.7)) {
          const t = pick([I32, I64]);
          const l = this.of(t);
          if (l.length) {
            this.load(t);
            this.e(0x21, uleb(pick(l)));
          }
        }
        this.store();
      }
      this.near = undefined;
    } else if (r < 70) this.set();
    else if (r < 84) this.add();
    else if (r < 92) {
      this.expr(I32, 2);
      this.e(0x04, 0x40);
      this.statement(depth - 1);
      if (chance(0.4)) {
        this.e(0x05);
        this.statement(depth - 1);
      }
      this.e(0x0b);
    } else if (depth > 0) this.loop(depth - 1);
    else this.store();
  }
  loop(depth) {
    const outer = [this.counter, this.end, [...this.pointers]];
    let pointer = 0;
    if (depth < 1 || chance(0.4)) {
      pointer = this.temp(I32);
      this.e(0x20, 0, c32(pick([0, 4, 16, 64, 1024])), 0x6a, 0x21, uleb(pointer));
      this.pointers.push(pointer);
    }
    const step = pick([1, 4, 4, 8, 8, 8, 16, 64, -4, -8]);
    const way = pick(["trap", "trap", "count", "count", "end", "value"]);
    const isInner = this.inLoop;
    this.inLoop = true;
    const before = chance(0.5);
    const advance = () => this.e(0x20, uleb(pointer), c32(step), 0x6a, 0x21, uleb(pointer));
    // A pointer that steps down from 0 traps at once and one that stands would never end: fuel ends every loop but those that a trap ends.
    const fuel = this.temp(I32);
    this.e(c32(isInner ? pick([2, 5, 9]) : way === "trap" ? 5000 : pick([3, 9, 60])), 0x21, uleb(fuel));
    if (way === "count") {
      this.counter = this.temp(I32);
      // Never 0: it would count through every number, and bytes that a program assembles are interpreted.
      this.e(0x20, 1, c32(15), 0x71, c32(1), 0x72, 0x21, uleb(this.counter));
    }
    if (way === "end") {
      this.end = this.temp(I32);
      this.e(0x20, uleb(pointer), c32(pick([16, 64, 256]) * Math.sign(step)), 0x6a, 0x21, uleb(this.end));
    }
    const isBare = way === "trap" && chance(0.7);
    this.e(0x02, 0x40, 0x03, 0x40);
    if (!isBare) this.e(0x20, uleb(fuel), 0x45, 0x0d, 1, 0x20, uleb(fuel), c32(1), 0x6b, 0x21, uleb(fuel));
    if (way === "end") this.e(0x20, uleb(pointer), 0x20, uleb(this.end), step > 0 ? pick([0x4f, 0x46]) : pick([0x4d, 0x46]), 0x0d, 1); // prettier-ignore
    if (before && way !== "trap") advance();
    for (let n = 1 + int(4); n > 0; n--) this.statement(isBare ? 0 : depth);
    // Without fuel the pointer that steps has to leave the memory.
    if (isBare) {
      const all = this.pointers;
      this.pointers = [pointer];
      this.store();
      this.pointers = all;
    }
    if (way === "value") {
      this.load(I32);
      this.e(c32(pick([0, 1, 2, -1])), pick([0x46, 0x47]), 0x0d, 1);
    }
    if (!before || way === "trap") advance();
    if (way === "count") this.e(0x20, uleb(this.counter), c32(1), 0x6b, 0x22, uleb(this.counter), 0x0d, 0);
    else this.e(0x0c, 0);
    this.e(0x0b, 0x0b);
    [this.counter, this.end, this.pointers] = outer;
    this.inLoop = isInner;
  }
  generate() {
    for (let n = int(3); n > 0; n--) this.statement(0);
    this.loop(1);
    if (chance(0.3)) this.loop(0);
    this.budget = 10;
    this.add();
    this.e(0x20, uleb(this.acc), 0x0b);
    return [...vec(this.extra.map(t => [1, t])), ...this.out];
  }
}

const specials = () => {
  const bytes = new Uint8Array(96);
  const view = new DataView(bytes.buffer);
  for (let at = 0; at < 96; at += 8)
    if (chance(0.5)) view.setBigInt64(at, pick(longs), true);
    else view.setFloat64(at, pick(floats), true);
  return [...bytes];
};

function randomModule() {
  const results = Array.from({ length: 3 + int(4) }, () => pick([I32, I32, I64, F32, F64]));
  const sigs = results.map(() => [I32, I32, ...(chance(0.5) ? [pick([I64, F64, F32])] : [])]);
  const helper = [...vec([]), 0x20, 0, c32(pick([1, 3, 255])).slice(0), pick([0x6a, 0x6c, 0x71, 0x73]), 0x0b].flat();
  const types: any[] = [];
  const typeOf = (p, r) => {
    const key = p + "|" + r;
    let at = types.findIndex(t => t[0] + "|" + t[1] === key);
    if (at < 0) at = types.push([p, r]) - 1;
    return at;
  };
  const helperType = typeOf([I32], [I32]);
  const bodies = sigs.map((p, i) => new Body(p, results[i], 1).generate());
  const functionTypes = [helperType, ...sigs.map((p, i) => typeOf(p, [results[i]]))];
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
    ...section(3, vec(functionTypes.map(uleb))),
    ...section(5, vec([chance(0.5) ? [0, 1] : [1, 1, pick([1, 2])]])),
    ...section(7, vec([...sigs.map((_, i) => [...str("f" + i), 0, ...uleb(i + 1)]), [...str("memory"), 2, 0]])),
    ...section(10, vec([helper, ...bodies].map(b => [...uleb(b.length), ...b]))),
    ...section(11, vec([0, 1024, 65536 - 96].map(at => [0, ...c32(at), 0x0b, ...vec(specials().map(b => [b]))]))),
  ];
  return { bytes: new Uint8Array(out), sigs };
}

// Runs every function from addresses at the begin, in the middle and at the end of the memory and prints what it returns or throws and a digest of the memory.
const driver = `const I32 = 0x7f, I64 = 0x7e;
const bases = [0, 65536 - 64, 1024, 65536 - 7, 512, 4, 60000, 65536, 2048];
const longs = [0x1000001000000001n, 1n, -1n, 0x7fffffffffffffffn, 0n, 0x20000000000001n];
const numbers = [1.5, 16777217, -0.5, 1e30, 0, 2147483648];
function run(index: number, module: WebAssembly.Module, sigs: number[][]): void {
  const all: any = new WebAssembly.Instance(module, {}).exports;
  const words = new Uint32Array(all.memory.buffer);
  const first = words.slice();
  const digest = (): string => { let h = 0, n = 0, at = -1; for (let i = 0; i < words.length; i++) { if (words[i] !== first[i]) { n++; if (at < 0) at = i; } if (words[i]) h = (Math.imul(h ^ words[i], 0x01000193) + i) | 0; } return h + " " + n + " " + at + " " + (at < 0 ? "" : words[at]); };
  const show = (v: any): string => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v));
  for (let f = 0; f < sigs.length; f++)
    for (let row = 0; row < 5; row++) {
      words.set(first);
      const base = bases[(row * 2 + f) % bases.length];
      const args = sigs[f].map((t, i) => (i === 0 ? base : t === I32 ? row * 3 + 1 : t === I64 ? longs[(row + f) % longs.length] : numbers[(row + f) % numbers.length]));
      let outcome;
      try { outcome = show(all["f" + f](...args)); }
      catch (error: any) { outcome = "!" + String(error.message).replace(/ \\(evaluating .*/s, "").split(" ").map(word => word[0]).join(""); }
      console.log(\`m\${index} f\${f}(\${args.map(show)}) = \${outcome}; \${digest()}\`);
    }
}
`;

export function generate(random: Random): string {
  R = () => random.next() / 4294967296;
  const text = [driver];
  for (let k = 0, n = random.between(1, 3); k < n; k++) {
    for (let tries = 0; tries < 20; tries++) {
      const { bytes, sigs } = randomModule();
      if (!WebAssembly.validate(bytes)) continue;
      text.push(`run(${k}, new WebAssembly.Module(${random.pick(encodings)(bytes)}), ${JSON.stringify(sigs)});`);
      break;
    }
  }
  return text.join("\n");
}
