// A value of a union of listed texts is tested, compared with written texts and then handed on as what the comparisons have left of the union.
type Mode = "a" | "b" | "c" | "d";
type Ext = "a" | "b" | "c";
const table: Record<string, Mode> = { one: "a", two: "b", three: "c", four: "d" };
function fromString(s: string): Mode { return (table[s] ?? s.slice(1)) as Mode; }
function isExt(m: Mode): m is Ext { return m !== "d"; }
export function narrowedAndReturned(s: string | undefined): Ext | undefined {
  const e = s ? fromString(s) : undefined;
  return e && isExt(e) && e !== "c" ? e : undefined;
}
export function comparedAndReturned(list: string[], i: number): "a" | "b" | undefined {
  const e = list[i] as Ext;
  return e !== "c" ? e : undefined;
}
const kept: { mode: "a" | "b" }[] = [];
export function comparedAndStored(list: string[], i: number): number {
  const e = list[i] as Ext;
  if (e === "c") return 0;
  kept.push({ mode: e });
  return kept.length;
}
export function truthyAndReturned(list: (string | undefined)[], i: number): Ext | "none" {
  const e = list[i] as Ext | undefined;
  return e ? e : "none";
}
export function switchedAndReturned(list: string[], i: number): "a" | "b" | "other" {
  const e = list[i] as Ext;
  switch (e) {
    case "a": return e;
    case "b": return e;
    default: return "other";
  }
}
const words = ["xa", "xb", "xc", "xd", "xe"].map(text => text.slice(1));
for (let round = 0; round < 3; round++) {
  for (const s of ["one", "two", "three", "four", "xa", "xc", "xz", "", undefined]) console.log(String(s), narrowedAndReturned(s));
  for (let i = 0; i < 6; i++) console.log(i, comparedAndReturned(words, i), comparedAndStored(words, i), truthyAndReturned(words, i), switchedAndReturned(words, i));
}
console.log(JSON.stringify(kept));
