// STATISTIC: StringForOfLoopsVersioned >= 1
// Texts that are written string and come out of JSON, joins, slices and lies (a list, a Set, a String object, null): their characters, with breaks, returns, throws, stores and handlers in the turn.
declare const process: { argv: string[] };
const hide = <T>(v: T): T => [v][JSON.parse("0") as number]!;
const texts: string[] = JSON.parse('["", "a", "abc/d", "\\ud83d\\ude00x", "x\\ud83d", "\\ude00y", "caf\\u00e9 \\u65e5", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"]');
function hash(h: number, s: string): number { for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h; }
function points(s: string): number { let n = 0; for (const c of s) n += c.codePointAt(0)!; return n; }
function seen(s: string): number { const set = new Set<string>(), map = new Map<string, number>(), o: Record<string, number> = {}; for (const c of s) { set.add(c); map.set(c, (map.get(c) ?? 0) + 1); o[c] = (o[c] ?? 0) + 1; } return set.size * 100 + map.size * 10 + Object.keys(o).length; }
function first(s: string): string { for (const c of s) { if (c === "/" || c === "b") return c; if (c === "d") break; } return "-"; }
function kept(s: string): string[] { const l: string[] = []; for (const c of s) { if (l.length > 4) break; l.push(c); } return l; }
function stored(s: string): string { let t = ""; for (const c of s) { if (c === "a") s = "zz"; t += c + s.length; } return t; }
function thrown(s: string): string { let t = ""; for (const c of s) { try { if (c === "c") throw new RangeError(c); t += c; } catch (e) { t += "!" + (e as Error).message; } finally { t += "."; } } return t; }
function sums(s: string, list: number[]): number { let n = 0; for (const c of s) n += list[c.charCodeAt(0) & 3]! * 0.5; return n; }
const lies: unknown[] = [["a", "b"], new Set("ab"), Object("obj"), new Map([["k", 1]]), Buffer.from("ab"), null, undefined, 5, { [Symbol.iterator]: function* () { yield "q"; yield "/"; } }];
const out: string[] = [];
for (let round = 0; round < 12; round++) {
  out.length = 0;
  for (const s of [...texts, texts[2]! + texts[3]!, texts[7]!.slice(3, 30), "in sight", `t${round & 1}`]) out.push(String(hash(5381, s)), String(points(s)), String(seen(s)), first(s), kept(s).join("."), stored(s), thrown(s), String(sums(s, [1, 2.5, 3, 4])));
  for (const v of lies) for (const g of [hash.bind(null, 7), points, seen, first, kept, stored, thrown] as ((s: string) => unknown)[]) { try { out.push(String(hide(g)(v as string))); } catch (e) { out.push((e as Error).name); } }
}
let h = 7; for (const x of out) for (let i = 0; i < x.length; i++) h = (Math.imul(h, 31) + x.charCodeAt(i)) | 0;
console.log(out.length, h);
export {};
