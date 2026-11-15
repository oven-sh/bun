// Loops over matchAll() of a literal where nothing proves that a string is searched: parameters, fields, results of calls, declared and not. Strings come, and String objects, objects with a matchAll of their own (lists, generators, iterators that are closed, nothing), nullish values, numbers. Matches are taken apart, kept, compared; named groups; the loops are left by break, return, throw, continue; in generators and async functions, one in another. What is printed is what plain Bun prints.
// STATISTIC: MatchIterationsInlined >= 6
const unseen = <T>(x: T): T => [x][JSON.parse("0")];
const log: string[] = [];
const show = (p: any): string => typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : typeof p === "symbol" ? "symbol" : Array.isArray(p) ? `[${Array.from(p, show).join()}${(p as any).index === undefined ? "" : "@" + (p as any).index}]` : p && typeof p === "object" ? "object" : String(p);
const say = (...parts: any[]) => { log.push(parts.map(show).join(" ")); };
function lengths(source: string): number { let n = 0; for (const m of source.matchAll(/([A-Za-z_$][\w$]*)|(\d+)/g)) n += m.index! + m[0].length + (m[2] ? 1 : 0); return n; }
function words(source: string): string { let out = ""; for (const m of source.matchAll(/(?<word>[a-z]+)|(?<digits>\d+)/g)) out += m.groups!.word !== undefined ? "w" + m.groups!.word.length : "d" + m.groups!.digits; return out; }
function first(source: string): string | undefined { for (const m of source.matchAll(/\d/g)) return m[0]; return undefined; }
function kept(source: any): any[] { const all: any[] = []; for (const m of source.matchAll(/(\w)(\d)?/g)) all.push(m); return all; }
function thrown(source: string): number { let n = 0; try { for (const m of source.matchAll(/[^,]+/g)) { if (m[0] === "stop") throw new RangeError(m[0]); n++; } } catch (e: any) { say("caught", e.name); return -n; } finally { say("finally", n); } return n; }
function pairs(source: string): string { const out: string[] = []; for (const [whole, key, value] of source.matchAll(/(\w+)=(\w*)/g)) out.push(whole.length + key + ":" + value); return out.join(); }
function nested(source: string): number { let n = 0; outer: for (const line of source.matchAll(/[^\n]+/g)) { for (const m of line[0].matchAll(/\w/g)) { n++; if (m[0] === "x") continue outer; if (m[0] === "z") break outer; } } return n; }
class Reader { text: string; constructor(text: string) { this.text = text; } *all(): Generator<string> { for (const m of this.text.matchAll(/\S+/g)) yield m[0]; } longest(): string { let found = ""; for (const m of this.text.matchAll(/[a-z]+/g)) if (m[0].length > found.length) found = m[0]; return found; } }
async function later(source: string): Promise<string[]> { const out: string[] = []; for (const m of source.matchAll(/\w+/g)) { await null; out.push(m[0] + m.index); } return out; }
const closures = (source: string): string => { const all: (() => string)[] = []; for (const m of source.matchAll(/./gs)) all.push(() => m[0]); return all.map(f => f()).join("|"); };
const texts = ["", "ab 12 c3", "a=b,key=value\nc,,d=\n", "x; y; z1", "one\ntwo\nthree", "stop", "p,x,q,stop,r", "\u4e2d,\u00e9 a1\n\u4e2d", unseen("le") + unseen("ft1,ri") + "ght\nend", "--cut1, here\nand,there--".slice(2, -2), "\ud83d\ude00a\ud83d"];
const generated = { *matchAll(pattern: RegExp) { try { yield ["g1"]; yield [pattern.source]; yield ["g3", "g4"]; } finally { say("closed"); } } };
let calls = 0;
const stepped = { matchAll() { let n = 0; return { [Symbol.iterator]() { return this; }, next() { return { done: ++n > 3, value: ["i" + n + ++calls] }; }, return(value: any) { say("return", n); return {}; } }; } };
const others: any[] = [new String("a1,b2\nc"), { matchAll: () => [["p"], ["q", "r"]] }, { matchAll(pattern: any) { say("own", pattern instanceof RegExp, pattern.lastIndex, arguments.length); const own: any[] = []; let m; while ((m = pattern.exec("a1=b2,c3")) && own.length < 3) own.push(m); return own; } }, generated, stepped, { matchAll: () => "text" }, { matchAll: () => null }, { matchAll: () => new Set([["s1"], ["s2"]]) }, { matchAll: 3 }, { get matchAll() { say("get"); return () => [["got"]]; } }, { matchAll() { throw new RangeError("own"); } }, null, undefined, 5, true, [1, 2], 10n, Symbol.iterator, Object.assign(() => 1, { matchAll: () => [["fn"]] })];
const runs: ((x: any) => any)[] = [lengths, words, first, kept, thrown, pairs, nested, x => [...new Reader(x).all()], x => new Reader(x).longest(), closures];
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
