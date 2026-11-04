// A method of a list, a text or a regular expression that is called by name outside a loop is one call of a stub, which looks at the receiver itself: whatever is not what its class makes is called by name.
import vm from "node:vm";
function attempt(f: () => unknown) { try { const v = f(); return Array.isArray(v) ? "[" + v.join() + "]" : String(v); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } }
function push(l: unknown[], v: unknown) { const n = l.push(v); return n; }
function includes(l: unknown[], v: unknown) { const r = l.includes(v); return r; }
function indexOf(l: unknown[], v: unknown) { const r = l.indexOf(v); return r; }
function slice(l: unknown[], a: number, b: number) { const r = l.slice(a, b); return r; }
function sliceAll(l: unknown[]) { const r = l.slice(); return r; }
function sort(l: unknown[]) { const r = l.sort(); return r; }
function join(l: unknown[], s: string) { const r = l.join(s); return r; }
function charAt(s: string, i: number) { const r = s.charAt(i); return r; }
function charCodeAt(s: string, i: number) { const r = s.charCodeAt(i); return r; }
function codePointAt(s: string, i: number) { const r = s.codePointAt(i); return r; }
function textSlice(s: string, a: number, b: number) { const r = s.slice(a, b); return r; }
function substring(s: string, a: number) { const r = s.substring(a); return r; }
function startsWith(s: string, t: unknown) { const r = s.startsWith(t as string); return r; }
function endsWith(s: string, t: unknown) { const r = s.endsWith(t as string); return r; }
function textIncludes(s: string, t: unknown) { const r = s.includes(t as string); return r; }
function textIndexOf(s: string, t: unknown) { const r = s.indexOf(t as string); return r; }
function replace(s: string, a: unknown, b: unknown) { const r = s.replace(a as string, b as string); return r; }
function replaceAll(s: string, a: unknown, b: unknown) { const r = s.replaceAll(a as string, b as string); return r; }
function split(s: string, t: unknown) { const r = s.split(t as string); return r; }
function lower(s: string) { const r = s.toLowerCase(); return r; }
function upper(s: string) { const r = s.toUpperCase(); return r; }
function trim(s: string) { const r = [s.trim(), s.trimStart(), s.trimEnd()].join("|"); return r; }
function test(p: RegExp, s: unknown) { const r = p.test(s as string); return r; }
(globalThis as any).held = [push, includes, indexOf, slice, sliceAll, sort, join, charAt, charCodeAt, codePointAt, textSlice, substring, startsWith, endsWith, textIncludes, textIndexOf, replace, replaceAll, split, lower, upper, trim, test];
class Mine extends Array<unknown> { push(...v: unknown[]) { return -1; } includes() { return true; } slice() { return ["mine"] as any; } }
const own: any = [1, 2, 3]; own.push = () => "own"; own.includes = () => "own";
const moved: any = [1, 2, 3]; Object.setPrototypeOf(moved, { push() { return "moved"; }, includes() { return "moved"; }, indexOf() { return "moved"; }, slice() { return "moved"; }, sort() { return "moved"; }, join() { return "moved"; } });
const frozen = Object.freeze([3, 1, 2]);
const foreign = vm.runInNewContext("[3, 1, 2]");
const lists: any[] = [[3, 1, 2], [1.5, NaN, -0], ["b", "a"], [], [1, , 3], Mine.from([1, 2]), own, moved, frozen, foreign, { length: 1, 0: "x", push: () => "object", includes: () => "object", indexOf: () => "object", slice: () => "object", sort: () => "object", join: () => "object" }, "text", null, 5];
for (let round = 0; round < 2; round++)
  for (const l of lists) console.log([attempt(() => includes(l, 1)), attempt(() => includes(l, NaN)), attempt(() => indexOf(l, 2)), attempt(() => indexOf(l, "a")), attempt(() => slice(l, 1, 3)), attempt(() => sliceAll(l)), attempt(() => join(l, "-")), attempt(() => push(l, 9)), attempt(() => sort(l))].join(" ; "));
console.log(sliceAll(foreign) instanceof Array, Array.isArray(sliceAll(foreign)));
const texts: any[] = ["Hello, World", "", "  pad  ", "\u{1F600}x", "a" + "b".repeat(3), new String("boxed"), { charAt: () => "object", charCodeAt: () => "object", codePointAt: () => "object", slice: () => "object", substring: () => "object", startsWith: () => "object", endsWith: () => "object", includes: () => "object", indexOf: () => "object", replace: () => "object", replaceAll: () => "object", split: () => "object", toLowerCase: () => "object", toUpperCase: () => "object", trim: () => "o", trimStart: () => "o", trimEnd: () => "o" }, 12, null, undefined, ["l", "i"]];
for (let round = 0; round < 2; round++)
  for (const s of texts) console.log([attempt(() => charAt(s, 1)), attempt(() => charAt(s, 99)), attempt(() => charCodeAt(s, 0)), attempt(() => charCodeAt(s, -1)), attempt(() => codePointAt(s, 0)), attempt(() => textSlice(s, 1, -1)), attempt(() => substring(s, 2)), attempt(() => startsWith(s, "He")), attempt(() => startsWith(s, /x/)), attempt(() => endsWith(s, "ld")), attempt(() => textIncludes(s, "lo")), attempt(() => textIncludes(s, 1)), attempt(() => textIndexOf(s, "o")), attempt(() => replace(s, "l", "L")), attempt(() => replace(s, /l/g, "L")), attempt(() => replace(s, "l", (m: string) => m + m)), attempt(() => replaceAll(s, "l", "$&$&")), attempt(() => split(s, "l")), attempt(() => split(s, /,\s*/)), attempt(() => split(s, undefined)), attempt(() => lower(s)), attempt(() => upper(s)), attempt(() => trim(s))].join(" ; "));
const sticky = /l/y, global = /l/g; const changed: any = /l/; changed.test = () => "own"; const withExec: any = /l/; withExec.exec = () => null;
for (const p of [/l+/, sticky, global, changed, withExec, { test: () => "object" }, null] as any[]) console.log([attempt(() => test(p, "hello")), attempt(() => test(p, "hello")), attempt(() => test(p, 5)), attempt(() => test(p, undefined)), p && p.lastIndex].join(" ; "));
