// `{ a, ...more }` in a loop, where more is an object or undefined | null | a number | false: the ways part in front of the literal: where there is nothing to copy nothing is called, and each way walks what is left of its block.
// STATISTIC: CopiesWalkedApartFromSourcesWithoutProperties >= 4
type More = { p: number; q?: string };
function orUndefined(a: number, more: More | undefined) { const o: any = { a, ...more }; return o; }
function orNull(a: number, more: More | null) { const o: any = { a, b: a + 1, ...more }; return o; }
function orNumber(a: number, more: More | number) { const o: any = { a, ...(more as any) }; return o; }
function orFalse(a: number, more: More | false) { const o: any = { a, ...(more as any), z: a }; return o; }
function overwrites(p: number, more: More | undefined) { const o: any = { p, ...more }; return o.p; }
function readBehind(a: number, more: More | undefined) { const o: any = { a, ...more }; return o.a + (o.p ?? 100); }
function show(o: any) { return typeof o === "object" ? JSON.stringify(o) + " " + Object.keys(o).join() : String(o); }
const sources: More[] = [{ p: 1 }, { p: 2, q: "two" }, { q: "first", p: 3 } as More];
const grown: any = { p: 4 }; grown.extra = "late";
const withGetter: any = { get p() { reads++; return 5; } };
let reads = 0;
const lines: string[] = [];
for (let i = 0; i < 24; i++) {
  const some: any = i % 7 === 5 ? grown : i % 7 === 6 ? withGetter : sources[i % 3];
  lines.push(show(orUndefined(i, i & 1 ? some : undefined)));
  lines.push(show(orNull(i, i & 2 ? some : null)));
  lines.push(show(orNumber(i, i % 3 ? some : i)));
  lines.push(show(orFalse(i, i % 5 ? some : false)));
  lines.push(show(overwrites(i, i & 1 ? undefined : some)));
  lines.push(show(readBehind(i, i & 4 ? some : undefined)));
}
console.log(lines.join("\n"));
console.log(reads);
