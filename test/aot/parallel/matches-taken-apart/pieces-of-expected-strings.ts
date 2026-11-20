// Loops over the pieces of split() where nothing proves that a string is split: parameters, fields, results of calls, declared and not. Strings come, and String objects, lists, objects with a split of their own (lists, generators, iterators that are closed, texts, nothing), nullish values, numbers. The loops are left by break, return, throw, continue; in generators and async functions, under finally, one in another. What is printed is what plain Bun prints.
// STATISTIC: SplitIterationsInlined >= 6
const unseen = <T>(x: T): T => [x][JSON.parse("0")];
const log: string[] = [];
const show = (p: any): string => typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : typeof p === "symbol" ? "symbol" : Array.isArray(p) ? `[${Array.from(p, show).join()}]` : p && typeof p === "object" ? "object" : String(p);
const say = (...parts: any[]) => { log.push(parts.map(show).join(" ")); };
function rows(source: string): number { let n = 0; for (const line of source.split("\n")) { const trimmed: string = line.trim(); if (!trimmed) continue; for (const cell of trimmed.split(",")) n += cell.length; } return n; }
function first(source: string): string | undefined { for (const line of source.split("\n")) { if (line !== "") return line; } return undefined; }
function kept(source: any): any[] { const all: any[] = []; for (const part of source.split(", ")) all.push(part, typeof part); return all; }
function thrown(source: string): number { let n = 0; try { for (const part of source.split(",")) { if (part === "stop") throw new RangeError(part); n++; } } catch (e: any) { say("caught", e.name); return -n; } finally { say("finally", n); } return n; }
function left(source: string): number { let n = 0; outer: for (let turn = 0; turn < 3; turn++) { for (const part of source.split(",")) { n++; if (part === "x") continue outer; if (part === "stop") break outer; } } return n; }
class Reader { text: string; constructor(text: string) { this.text = text; } *lines(): Generator<string> { for (const line of this.text.split("\n")) yield line; } longest(): string { let found = ""; for (const line of this.text.split("\n")) if (line.length > found.length) found = line; return found; } }
async function later(source: string): Promise<string[]> { const out: string[] = []; for (const part of source.split("; ")) { await null; out.push(part + "!"); } return out; }
const closures = (source: string): string => { const all: (() => string)[] = []; for (const part of source.split(",")) all.push(() => part); return all.map(f => f()).join("|"); };
const counted = (source: string): number => { let sum = 0; for (const part of source.split("ab")) { sum += +part || part.length; if (sum > 50) break; } return sum; };

const texts = ["", "ab 12 c3", "a,b\nc,,d\n", "x; y; z1", "one\ntwo\nthree", "1ab2ab3", "stop", "p,x,q,stop,r", "\n\n", "中,é\n中", unseen("le") + unseen("ft,ri") + "ght\nend", "--cut, here\nand,there--".slice(2, -2)];
const generated = { *split(separator: string) { try { yield "g1"; yield separator; yield "g3"; } finally { say("closed"); } } };
let calls = 0;
const stepped = { split() { let n = 0; return { [Symbol.iterator]() { return this; }, next() { return { done: ++n > 3, value: "i" + n + ++calls }; }, return(value: any) { say("return", n); return {}; } }; } };
const others: any[] = [new String("a,b\nc"), { split: () => ["p", "q"] }, { split(separator: any) { say("split", separator, arguments.length); return [separator, "stop", "x"]; } }, generated, stepped, { split: () => "text" }, { split: () => null }, { split: () => new Set(["s1", "s2"]) }, { split: 3 }, { get split() { say("get"); return () => ["got"]; } }, { split() { throw new RangeError("own"); } }, null, undefined, 5, true, [1, 2], 10n, Symbol.iterator, Object.assign(() => 1, { split: () => ["fn"] })];
const runs: ((x: any) => any)[] = [rows, first, kept, thrown, left, x => [...new Reader(x).lines()], x => new Reader(x).longest(), closures, counted];
for (let turn = 0; turn < 3; turn++) {
  for (const x of turn === 1 ? [...texts, ...others, ...texts] : texts) {
    for (const run of runs) {
      try {
        say(run(x));
      } catch (e: any) {
        say(e.name);
      }
    }
    try {
      say(await later(x));
    } catch (e: any) {
      say(e.name);
    }
  }
}
console.log(log.length + "\n" + log.join("\n"));
export {};
