// Integers beside `undefined` and `null` whose type says they are integers (enums, results of bit operations, lengths): in bit operations and as conditions.
declare const console: { log(...values: unknown[]): void };
const enum Check { None = 0, Instantiated = 1, Synthetic = 2, Readonly = 8, Late = 4096, High = 1 << 30, Sign = -2147483648, All = -1 }
class Links { check?: Check; other?: Check | null; }
class Sym { flags: Check = Check.None; links: Links | undefined = undefined; }
function checkOf(s: Sym): Check | undefined { return s.flags & Check.Synthetic ? s.links!.check : Check.None; }
function otherOf(s: Sym): Check | null | undefined { return s.links ? s.links.other : undefined; }
function has(s: Sym, mask: Check): boolean { return ((checkOf(s) as Check) & mask) !== 0; }
function bits(s: Sym): string { const c = checkOf(s) as Check; return [c & 9, c | 2, c ^ 5, ~c, c << 3, c >> 2, c >>> 29, c & Check.Sign, c | 0].join(","); }
function otherBits(s: Sym): string { const c = otherOf(s) as Check; return [c & 4097, c | 0, c ^ -1, c >>> 0, c << 31].join(","); }
function truthy(s: Sym): string { return (checkOf(s) ? "c" : "-") + (otherOf(s) ? "o" : "-") + (!checkOf(s) ? "C" : "-") + (!otherOf(s) ? "O" : "-") + (checkOf(s) && otherOf(s) ? "&" : "-") + (checkOf(s) || otherOf(s) ? "|" : "-"); }
function lengthOf(text: string | undefined): number | undefined { return text === undefined ? undefined : text.length; }
function lengths(text: string | undefined): string { const n = lengthOf(text); return (n ? "some" : "none") + ((n as number) & 3) + ((n as number) | 16) + (n === undefined ? "u" : "d") + (n === 0 ? "z" : "n"); }
function indexIn(list: string[], what: string): number | undefined { const at = list.indexOf(what); return at < 0 ? undefined : at; }
function indexes(list: string[], what: string): string { const at = indexIn(list, what); return (at ? "t" : "f") + ((at as number) & 1) + ((at as number) << 1) + (at ?? "nothing"); }
function count(all: Sym[]): number { let n = 0; for (const s of all) { if (checkOf(s)) n++; if ((checkOf(s) as Check) & Check.Readonly) n += 100; if (otherOf(s)) n += 10000; } return n; }
function make(flags: Check, check: Check | undefined, other: Check | null | undefined, withLinks: boolean): Sym { const s = new Sym(); s.flags = flags; if (withLinks) { s.links = new Links(); if (check !== undefined) s.links.check = check; if (other !== undefined) s.links.other = other; } return s; }
const values: (Check | undefined)[] = [undefined, Check.None, Check.Instantiated, Check.Readonly, Check.Late, Check.High, Check.Sign, Check.All, Check.Readonly | Check.Late, Check.High | Check.Sign];
const all: Sym[] = [make(Check.None, undefined, undefined, false)];
for (const check of values) for (const other of [undefined, null, Check.None, Check.Late, Check.Sign, Check.All] as (Check | null | undefined)[]) { all.push(make(Check.Synthetic, check, other, true)); all.push(make(Check.Instantiated, check, other, true)); }
for (const s of all) console.log(has(s, Check.Readonly), has(s, Check.Sign), has(s, Check.All), bits(s), otherBits(s), truthy(s));
for (const text of [undefined, "", "a", "abcd", "abcdefghijklmnopq"]) console.log(lengths(text));
for (const what of ["a", "b", "c", "z"]) console.log(indexes(["a", "b", "c"], what));
console.log(count(all));
