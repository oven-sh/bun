// STATISTIC: ArrayOrStringLoopsVersioned >= 2
// Who writes `string | string[]` in checked TypeScript gets what the untyped twin gets: the loop asks in front which of the two it is. The guard tested for the list of the union, and a text ran the slow version.
const key: string = JSON.parse('"go"');
function count(s: string | string[]): number { let c = 0; for (let i = 0; i <= s.length; i++) if (s[i] === ",") c++; return c; }
function range(s: string | readonly string[] | undefined | null): number { if (!s) return -1; let c = 0; for (let i = 0; i < s.length; i++) if (s[i]! >= "a" && s[i]! <= "f") c++; return c; }
const counts: Record<string, (s: string | string[]) => number> = { go: count };
const ranges: Record<string, (s: string | readonly string[] | undefined | null) => number> = { go: range };
const given: (string | string[])[] = [JSON.parse('"ab,cd,,\\u00e9\\ud83d\\ude00,"'), "", ",", "a".repeat(40) + ",", ("x,".repeat(20) + "y").slice(1), JSON.parse('["a",",","bc",","]'), [",", , ","] as string[], [], Object.freeze(["f", ","]) as string[]];
for (const s of given) for (let turn = 0; turn < 3; turn++) console.log(counts[key]!(s), ranges[key]!(s), count(s), range(s));
console.log(ranges[key]!(undefined), ranges[key]!(null), range(undefined));
const untyped: any[] = [JSON.parse("7"), JSON.parse('{"length":2,"0":",","1":"a"}'), new Uint8Array([44]), new String("a,")];
for (const s of untyped) { let said: string; try { said = counts[key]!(s) + " " + ranges[key]!(s); } catch (e) { said = (e as Error).name; } console.log(said); }
