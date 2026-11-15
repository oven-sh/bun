// (condition ? one : other)[i] in loops: the arrays come from before the loop. They hold int32s, doubles, holes, texts, nothing; they are the same, frozen, short, cut or converted in the middle, or no arrays.
function shown(x: any): string { return Array.isArray(x) || ArrayBuffer.isView(x) ? `[${(x as any).length}:${Array.from({ length: Math.min((x as any).length, 8) }, (_, i) => (i in (x as any) ? shown((x as any)[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

function sum(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) s += (i & 1 ? one : other)[i]!; return s; }
function named(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { const taken = i % 3 ? one : other; s += taken[i]! + taken.length; } return s; }
function reassigned(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { let taken = one; if (i & 1) taken = other; s += taken[i]!; } return s; }
function ofThree(one: number[], other: number[], third: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { const m = i % 3; s += (m === 0 ? one : m === 1 ? other : third)[i]!; } return s; }
function invariant(one: number[], other: number[], which: boolean): any { let s: any = 0; for (let i = 0; i < 12; i++) s += (which ? one : other)[i]!; return s; }
function lengths(one: number[], other: number[]): any { let s = 0; for (let i = 0; i < 12; i++) s += (i & 1 ? one : other).length; return s; }
function stored(one: number[], other: number[]): any { for (let i = 0; i < 12; i++) (i & 1 ? one : other)[i] = i * 3; return [one, other]; }
function storedHalves(one: number[], other: number[]): any { for (let i = 0; i < 6; i++) (i & 1 ? one : other)[i] = i / 2; return [one, other]; }
function updated(one: number[], other: number[]): any { for (let i = 0; i < 6; i++) (i & 1 ? one : other)[i]! += i; return [one, other]; }
function merged(one: number[], other: number[]): any { const out: any[] = []; let i = 0, k = 0; while (i < one.length && k < other.length && out.length < 20) { const fromOne = one[i]! <= other[k]!; out.push((fromOne ? one : other)[fromOne ? i++ : k++]); } return out; }
function cut(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { s += (i & 1 ? one : other)[i]!; if (i === 5) one.length = 3; } return s; }
function grown(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { s += (i & 1 ? one : other)[i]!; if (i === 4) other.push(i + 0.5); } return s; }
function converted(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { s += (i & 1 ? one : other)[i]!; if (i === 4) (one as any)[7] = "text"; } return s; }
function nested(one: number[], other: number[]): any { let s: any = 0; for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) s += ((x + y) & 1 ? one : other)[y * 4 + x]!; return s; }
function switched(one: number[], other: number[]): any { let s = 0; for (let i = 0; i < 12; i++) switch ((i & 1 ? one : other)[i]) { case 1: s += 1; break; case 2: s += 20; break; case 3: s += 300; break; default: s += 4000; } return s; }
function pickedInTry(one: number[], other: number[]): any { let s: any = 0; for (let i = 0; i < 12; i++) { try { s += (i & 1 ? one : other)[i]!; } catch (e) { s += "!"; } } return s; }

const lists: (() => any)[] = [
  () => Array.from({ length: 12 }, (_, i) => i),
  () => Array.from({ length: 12 }, (_, i) => i + 0.5),
  () => JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]"),
  () => [1, , 3, 4, , 6, 7, 8, 9, 10, 11, 12],
  () => [1.5, , 3, 4, , 6, 7.25, 8, 9, 10, 11, 12],
  () => [1, 2, NaN, -0, 5, 6, 7, 8, 9, 1e300, 11, 12],
  () => ["a", "b", 3, 4, 5, "f", 7, 8, 9, 10, 11, 12],
  () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  () => [1, 2, 3],
  () => [],
  () => new Array(12),
  () => Int32Array.from({ length: 12 }, (_, i) => i * 2),
  () => Float64Array.from({ length: 12 }, (_, i) => i / 4),
  () => [1, undefined, null, true, 5, 6, 7, 8, 9, 10, 11, 12],
  () => new (class Own extends Array<number> {})(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
  () => ({ length: 12, 0: 1, 1: 2, 2: 3 }),
  () => undefined,
];
const functions: any[] = [sum, named, reassigned, ofThree, invariant, lengths, stored, storedHalves, updated, merged, cut, grown, converted, nested, switched, pickedInTry];
for (const run of functions) {
  const lines: string[] = [];
  for (let one = 0; one < lists.length; one++) {
    for (let other = 0; other < lists.length; other += one % 3 + 1) {
      const a = veil(lists[one]!()), b = one === other ? a : veil(lists[other]!());
      let answer: string;
      try { answer = shown(run(a, b, run === invariant ? other % 2 === 0 : a)); } catch (e: any) { answer = e.constructor.name; }
      lines.push(answer + shown(a) + shown(b));
    }
  }
  console.log(run.name, lines.length, Bun.hash(lines.join("\n")).toString(16), lines[0], lines[7], lines[40]);
}
export {};
