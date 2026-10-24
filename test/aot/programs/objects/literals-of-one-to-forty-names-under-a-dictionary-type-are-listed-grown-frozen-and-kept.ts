// A literal whose type is a dictionary is an ordinary object. However many names it has, it lists them in the order written,
// takes more names, loses names, is frozen, copied and collected like any other.
type Table = Record<string | symbol, unknown>;
function make1(base: number): Table { return { k0: base + 0 }; }
function make5(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4 }; }
function make6(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5 }; }
function make7(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6 }; }
function make8(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7 }; }
function make9(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8 }; }
function make10(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9 }; }
function make11(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10 }; }
function make12(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11 }; }
function make13(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12 }; }
function make14(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13 }; }
function make15(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14 }; }
function make16(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15 }; }
function make17(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16 }; }
function make18(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17 }; }
function make19(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18 }; }
function make20(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19 }; }
function make24(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23 }; }
function make31(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23, k24: base + 24, k25: base + 25, k26: base + 26, k27: base + 27, k28: base + 28, k29: base + 29, k30: base + 30 }; }
function make32(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23, k24: base + 24, k25: base + 25, k26: base + 26, k27: base + 27, k28: base + 28, k29: base + 29, k30: base + 30, k31: base + 31 }; }
function make33(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23, k24: base + 24, k25: base + 25, k26: base + 26, k27: base + 27, k28: base + 28, k29: base + 29, k30: base + 30, k31: base + 31, k32: base + 32 }; }
function make34(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23, k24: base + 24, k25: base + 25, k26: base + 26, k27: base + 27, k28: base + 28, k29: base + 29, k30: base + 30, k31: base + 31, k32: base + 32, k33: base + 33 }; }
function make40(base: number): Table { return { k0: base + 0, k1: base + 1, k2: base + 2, k3: base + 3, k4: base + 4, k5: base + 5, k6: base + 6, k7: base + 7, k8: base + 8, k9: base + 9, k10: base + 10, k11: base + 11, k12: base + 12, k13: base + 13, k14: base + 14, k15: base + 15, k16: base + 16, k17: base + 17, k18: base + 18, k19: base + 19, k20: base + 20, k21: base + 21, k22: base + 22, k23: base + 23, k24: base + 24, k25: base + 25, k26: base + 26, k27: base + 27, k28: base + 28, k29: base + 29, k30: base + 30, k31: base + 31, k32: base + 32, k33: base + 33, k34: base + 34, k35: base + 35, k36: base + 36, k37: base + 37, k38: base + 38, k39: base + 39 }; }
const makers: [number, (base: number) => Table][] = [[1, make1], [5, make5], [6, make6], [7, make7], [8, make8], [9, make9], [10, make10], [11, make11], [12, make12], [13, make13], [14, make14], [15, make15], [16, make16], [17, make17], [18, make18], [19, make19], [20, make20], [24, make24], [31, make31], [32, make32], [33, make33], [34, make34], [40, make40]];

function withGetter(base: number): Table { return { a: base, b: base + 1, c: base + 2, d: base + 3, get e() { return base + 4; }, f: base + 5, g: base + 6, h: base + 7, i: base + 8, j: base + 9 }; }
function withPrototype(base: number, above: object | null): Table { return { a: base, b: base + 1, c: base + 2, d: base + 3, __proto__: above, e: base + 4, f: base + 5, g: base + 6, h: base + 7, i: base + 8 }; }
function withComputed(base: number, key: string): Table { return { a: base, b: base + 1, c: base + 2, d: base + 3, [key]: base + 4, e: base + 5, f: base + 6, g: base + 7, h: base + 8, i: base + 9 }; }
function withIndexes(base: number): Table { return { a: base, b: base + 1, c: base + 2, 1: base + 3, d: base + 4, e: base + 5, f: base + 6, 0: base + 7, g: base + 8, h: base + 9 }; }
function withSpread(base: number, more: Table): Table { return { a: base, b: base + 1, c: base + 2, d: base + 3, ...more, e: base + 5, f: base + 6, g: base + 7, h: base + 8 }; }
function withCells(base: number): Table { return { a: [base], b: { base }, c: "t" + base, d: () => base, e: null, f: undefined, g: base + 0.5, h: Symbol.for("s" + base), i: BigInt(base), j: true }; }

const keys = ["k0", "k3", "k6", "k7", "other", "k15", "k16", "k31", "k39", "0"];
let lines = 0;
function say(...parts: unknown[]) { lines++; console.log(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part, (_, v) => (typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? String(v) : typeof v === "function" ? "fn" : v)))).join(" ")); }

for (let turn = 0; turn < 40; turn++) {
  const loud = turn === 0 || turn === 39;
  for (const [size, make] of makers) {
    const table = make(turn);
    const listed = Object.keys(table);
    if (listed.length !== size || listed.join() !== Array.from({ length: size }, (_, i) => "k" + i).join()) say("WRONG ORDER", size, listed);
    let sum = 0;
    for (const key in table) sum += table[key] as number;
    if (sum !== size * turn + (size * (size - 1)) / 2) say("WRONG SUM", size, sum);
    table[keys[turn % keys.length]] = "stored";
    table.late = turn;
    table["later" + (turn & 1)] = turn;
    delete table[keys[(turn + 3) % keys.length]];
    if (loud) say(size, table, Object.getOwnPropertyNames(table).length, Object.isExtensible(table));
    if (turn % 5 === 0) {
      Object.freeze(table);
      try { "use strict"; (table as any).k0 = 1; } catch (error) { if (loud) say(size, (error as Error).constructor.name); }
      if (loud) say(size, Object.isFrozen(table), Object.getOwnPropertyDescriptor(table, "k1") ?? "none");
    }
    const copy = { ...table, extra: 1 };
    if (Object.keys(copy).length !== Object.keys(table).length + 1) say("WRONG COPY", size);
  }
  const others = [withGetter(turn), withPrototype(turn, turn & 1 ? null : { above: turn }), withComputed(turn, turn & 1 ? "b" : "z"), withIndexes(turn), withSpread(turn, make7(turn)), withSpread(turn, { b: "over", e: "under" }), withCells(turn)];
  if (loud) for (const table of others) say(table, Reflect.ownKeys(table).map(String), Object.getPrototypeOf(table) === Object.prototype, (table as any).above ?? "-");
}

// Many at once, across collections: each keeps what it was given.
const kept: Table[] = [];
for (let i = 0; i < 60000; i++) { const [, make] = makers[i % makers.length]; kept.push(make(i)); if (kept.length > 3000) kept.splice(0, 1500); }
Bun.gc(true);
let wrong = 0;
for (const table of kept) { const base = table.k0 as number; let i = 0; for (const key in table) if (table[key] !== base + i++) wrong++; }
say("kept", kept.length, "wrong", wrong, "lines", lines);
