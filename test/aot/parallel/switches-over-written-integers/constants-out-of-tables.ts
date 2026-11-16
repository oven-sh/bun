// Switches whose cases bring constants to one join or return them load them out of tables: every form of constant, gaps, subjects at and past the ends of the table, and what is no integer.
// STATISTIC: SwitchesLoweredToValueTables >= 6
// STATISTIC: SwitchesLoweredToReturnTables >= 4
// STATISTIC: JoinsCarriedUnboxed >= 1
enum Kind { A, B, C, D }
const kinds = [Kind.A, Kind.B, Kind.C, Kind.D];
function weigh(kind: Kind): number { switch (kind) { case Kind.A: return 1; case Kind.B: return 20; case Kind.C: return 3; case Kind.D: return 40; } }
function bytes(x: number): number { switch (x) { case 0: return 5; case 1: return 7; case 2: return 1; case 3: return 9; case 4: return 2; default: return 0; } }
function words(x: number): number { switch (x) { case -2: return -2147483648; case -1: return 70000; case 0: return 2147483647; case 1: return -1; case 3: return 12; default: return 6; } }
function wide(x: number): number { switch (x) { case 100: return 4294967296; case 101: return -9007199254740991; case 102: return 9007199254740991; case 103: return 1; case 104: return -0; default: return 2; } }
function halves(x: number): number { switch (x) { case 7: return 0.5; case 8: return -0; case 9: return NaN; case 10: return Infinity; case 11: return 1e300; default: return -2.25; } }
function some(x: number) { switch (x) { case 1: return 4; case 2: return undefined; case 3: return null; case 4: return 0.5; case 5: return 2147483648; case 6: return -0; } }
function atTop(x: number): number { switch (x) { case 2147483644: return 3; case 2147483645: return 1; case 2147483646: return 4; case 2147483647: return 2; default: return 5; } }
function atBottom(x: number): number { switch (x) { case -2147483648: return 3; case -2147483647: return 1; case -2147483646: return 4; case -2147483645: return 2; default: return 5; } }
function throws(x: number): number { switch (x) { case 3: return 8; case 4: return 6; case 5: return 4; case 6: return 2; default: throw new RangeError("no case for " + x); } }
const near: number[] = [];
for (const base of [-2147483648, -2, 0, 2, 5, 8, 100, 103, 2147483645, 4294967296, 4294967300, -4294967297]) for (let i = -3; i <= 3; i++) near.push(base + i, base + i + 0.5);
near.push(-0, NaN, Infinity, -Infinity, 9007199254740991, -9007199254740991);
const strange: any[] = [undefined, null, true, "1", "", 3n, {}, [3], Symbol.iterator];
const show = (value: unknown) => Object.is(value, -0) ? "-0" : String(value);
const all: string[] = [];
for (const f of [bytes, words, wide, halves, some, atTop, atBottom]) {
  let line = "";
  for (const x of near) line += show(f(x)) + " ";
  for (const x of strange) line += show(f(x)) + " ";
  all.push(line);
}
for (const x of near) { try { all.push(show(throws(x))); } catch (error) { all.push((error as Error).message); } }
console.log(all.join("\n"));
function inLoops(turns: number) {
  let sum = 0, low = 0, joined = "", both = 0;
  for (let k = 0; k < turns; k++) {
    sum += weigh(kinds[k & 3]!) + bytes(k & 7);
    low = (low + words((k % 9) - 4)) | 0;
    if (k < 40) joined += show(halves(6 + k % 7)) + " " + show(wide(99 + k % 7)) + " " + show(some(k % 8)) + ",";
    let a: number, b: number;
    switch (k % 6) { case 0: a = 4; b = 0.5; break; case 1: a = 8; b = 1.5; break; case 2: a = 1; b = -0; break; case 3: a = 9; b = 2.5; break; default: a = 6; b = 7; }
    both += a * b;
  }
  return [sum, low, both, joined].join(" ");
}
console.log(inLoops(10), inLoops(5000));
console.log(weigh(7 as Kind), weigh("1" as any), String(weigh(undefined as any)));
