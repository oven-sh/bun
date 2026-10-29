// Records with optional members are spread into literals of other types, so each member goes from the slot of one record into the slot of another.
// The numbers are small integers, integers that need more than 32 bits, fractions, -0 and NaN; a member may hold undefined or null, or be left out.
interface Counts { a?: number; b?: number; c?: number; d?: number; e?: number }
interface Sizes { a?: number; b?: number; c?: number; d?: number; e?: number }
interface Flags { on?: boolean; off?: boolean; a?: number }
interface LabeledCounts extends Counts { label: number }
interface LabeledSizes extends Sizes { label: number }
interface LabeledFlags extends Flags { label: number }
interface Wide { label: number; a?: number | string; b?: number | boolean; c?: unknown; d?: number | null; e?: number | undefined; on?: boolean | number; off?: unknown }

function show(o: any): string {
  return "{" + Object.keys(o).map(k => k + ":" + (Object.is(o[k], -0) ? "-0" : String(o[k]))).join() + "}";
}

function counts(bits: number, n: number): Counts {
  const made: Counts = {};
  if (bits & 1) made.a = n;
  if (bits & 2) made.b = n + 1;
  if (bits & 4) made.c = n + 2;
  if (bits & 8) made.d = n + 3;
  if (bits & 16) made.e = n + 4;
  return made;
}
function sizes(bits: number, n: number): Sizes {
  const made: Sizes = {};
  if (bits & 1) made.a = n / 2;
  if (bits & 2) made.b = n * 4294967296;
  if (bits & 4) made.c = -0 * n;
  if (bits & 8) made.d = n - n ? 1 : 0 / 0;
  if (bits & 16) made.e = n * 1e300;
  return made;
}
function flags(bits: number, n: number): Flags {
  const made: Flags = {};
  if (bits & 1) made.on = (n & 1) === 1;
  if (bits & 2) made.off = (n & 1) === 0;
  if (bits & 4) made.a = n;
  return made;
}

function labelCounts(from: Counts, label: number): LabeledCounts { return { label, ...from }; }
function labelSizes(from: Sizes, label: number): LabeledSizes { return { label, ...from }; }
function labelFlags(from: Flags, label: number): LabeledFlags { return { label, ...from }; }
function countsAsSizes(from: Counts, label: number): LabeledSizes { return { label, ...from }; }
function countsAsWide(from: Counts, label: number): Wide { return { label, ...from }; }
function sizesAsWide(from: Sizes, label: number): Wide { return { label, ...from }; }
function flagsAsWide(from: Flags, label: number): Wide { return { label, ...from }; }
function labeledAsCounts(from: LabeledCounts): Counts { const { label, ...others } = from; return others; }
function bothAsWide(first: Counts, second: Flags, label: number): Wide { return { label, ...first, ...second }; }
function sum(o: LabeledCounts | LabeledSizes): string { return String((o.a ?? 0) + (o.b ?? 0) + (o.c ?? 0) + (o.d ?? 0) + (o.e ?? 0)); }
function kinds(o: LabeledCounts | LabeledSizes): string { return [o.a, o.b, o.c, o.d, o.e].map(v => (v === undefined ? "u" : v === null ? "n" : typeof v === "number" ? "#" : "?")).join(""); }

// What the types do not say: a member gets undefined, null, a fraction, a large integer or a text, by a name that is a value.
const odd: [string, unknown][] = [["undefined", undefined], ["null", null], ["a fraction", 0.5], ["over 32 bits", 2 ** 40 + 1], ["the least int32", -2147483648], ["near the least int32", -2147483646], ["a text", "text"], ["true", true]];
function withOdd<T extends object>(made: T, name: string, value: unknown): T { (made as any)[name] = value; return made; }

const lines: string[] = [];
for (let round = 0; round < 4; round++) {
  for (const bits of [0, 1, 2, 5, 10, 21, 31]) {
    const n = round * 100 + bits;
    const c = labelCounts(counts(bits, n), round);
    const s = labelSizes(sizes(bits, n), round);
    lines.push(show(c), sum(c), kinds(c), show(s), sum(s), kinds(s));
    lines.push(show(labelFlags(flags(bits, n), round)), show(countsAsSizes(counts(bits, n), round)), show(countsAsWide(counts(bits, n), round)));
    lines.push(show(sizesAsWide(sizes(bits, n), round)), show(flagsAsWide(flags(bits, n), round)), show(labeledAsCounts(c)), show(bothAsWide(counts(bits, n), flags(bits, n), round)));
  }
  for (const [what, value] of odd) {
    for (const name of ["a", "c", "e"]) {
      const c = labelCounts(withOdd(counts(21, round), name, value), round);
      const s = labelSizes(withOdd(sizes(21, round + 1), name, value), round);
      lines.push(what + " in " + name, show(c), sum(c), kinds(c), show(s), sum(s), kinds(s));
      lines.push(show(countsAsSizes(withOdd(counts(31, round), name, value), round)), show(countsAsWide(withOdd(counts(31, round), name, value), round)), show(labeledAsCounts(c)));
    }
    for (const name of ["on", "off", "a"]) {
      lines.push(what + " in " + name, show(labelFlags(withOdd(flags(7, round), name, value), round)), show(flagsAsWide(withOdd(flags(7, round), name, value), round)));
      lines.push(show(bothAsWide(counts(3, round), withOdd(flags(7, round), name, value), round)));
    }
  }
}
console.log(lines.join("\n"));
