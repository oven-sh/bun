// A field that most objects never get lies out of line. Stored as undefined it exists and takes no storage: reads, `in`, the keys and their order must say so, object by object, however often the same question was asked before.
interface Sym {
  flags: number; name: string;
  a00?: Sym; a01?: Map<string, Sym>; a02?: Map<string, Sym>; a03?: boolean; a04?: Sym[]; a05?: number; a06?: string; a07?: Sym; a08?: Sym; a09?: Sym;
  a10?: Sym; a11?: Map<string, Sym>; a12?: Map<string, Sym>; a13?: boolean; a14?: Sym[]; a15?: number; a16?: string; a17?: Sym; a18?: Sym; a19?: Sym;
}
function make(i: number): Sym {
  return { flags: i, name: "s" + i };
}
function touch(s: Sym, i: number): number {
  let n = 0;
  if (!s.a01) { n++; if (i % 3 === 0) s.a01 = new Map(); else if (i % 3 === 1) s.a01 = undefined; }
  if (!s.a12) { n += 2; if (i % 5 === 0) s.a12 = undefined; }
  if (s.a13 && s.flags & 1) s.a13 = false;
  if (i % 7 === 0) s.a13 = undefined;
  if (i % 11 === 0) s.a13 = true;
  return n;
}
function describe(s: Sym): string {
  return [Object.keys(s).join(","), "a01" in s, "a12" in s, "a13" in s, s.a01 === undefined, s.a12 === undefined, s.a13, Object.hasOwn(s, "a12")].join(" ");
}
const all: Sym[] = [];
let total = 0;
for (let i = 0; i < 3000; i++) {
  const s = make(i);
  total += touch(s, i);
  total += touch(s, i + 1);
  all.push(s);
}
console.log(total);
const kinds = new Map<string, number>();
for (const s of all) kinds.set(describe(s), (kinds.get(describe(s)) ?? 0) + 1);
for (const [kind, count] of [...kinds].sort()) console.log(count, kind);
for (let i = 0; i < all.length; i += 4) delete all[i].a12;
for (let i = 0; i < all.length; i += 6) (all[i] as any).extra = i;
let there = 0;
for (const s of all) there += ("a12" in s ? 1 : 0) + (touch(s, 2) << 1) + ("a12" in s ? 4 : 0);
console.log(there);
kinds.clear();
for (const s of all) kinds.set(describe(s), (kinds.get(describe(s)) ?? 0) + 1);
console.log(kinds.size, [...kinds.values()].sort((a, b) => a - b).join(","));
