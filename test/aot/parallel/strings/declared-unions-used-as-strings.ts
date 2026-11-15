// Values declared a string or a number, used under names of strings in loops, and what comes instead of them.
// STATISTIC: StringsChosenByNames >= 20
const all: boolean = process.argv[2] === "all"; let lines = 0, hash = 0, log = "";
function say(line: string): void { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 220)); else if (lines % 23 === 0) console.log(lines, hash); }
class Like { length = 2; charCodeAt(i: number): number { log += "c"; return 60 + i; } charAt(i: number): string { log += "a"; return "L" + i; } indexOf(x: any): number { log += "i"; return 7; } slice(a: number, b: number): string { return "like"; } startsWith(x: string): boolean { return true; } toUpperCase(): string { return "LIKE"; } split(x: string): string[] { return ["l", "k"]; } trim(): string { return "t"; } padStart(n: number, x: string): string { return "pad"; } includes(x: string): boolean { return true; } *[Symbol.iterator](): any { yield "y"; } }
const words: any[] = JSON.parse('["word","a","","r o w","日本"," pad "]'), rope = (): any => words[0] + words[3] + "x";
const given: Record<string, () => any[]> = {
  words: () => words.slice(), numbers: () => [1, 2.5, -0], mixed: () => ["word", 5, "row"], later: () => ["one", "two", "three", 4], nil: () => ["w", null], undef: () => [undefined, "w"], like: () => [new Like(), "w", new Like()], boxed: () => [new String("boxed"), "w"], lists: () => [["w", "o"], "wo"], ropes: () => [rope(), rope(), "flat"], pieces: () => ["word row word".slice(5, 8), "aw"], truths: () => [true, "t"], symbols: () => [Symbol.iterator], bigs: () => [1n], proxies: () => [new Proxy(new String("p"), {})], records: () => [{ length: 1, 0: "z" }], none: () => [], many: () => Array.from({ length: 70 }, (_, i) => "row" + i), functions: () => [function w(a: any, b: any) {}], bytes: () => [new Uint8Array([119, 111])], long: () => ["w".repeat(300), "o"],
};
const shaped: Record<string, (l: any[]) => any> = { second: l => l.map((w, i) => [i, w]), first: l => l.map((w, i) => [w, i]), plain: l => l, both: l => l.map(w => [w, w]), short: l => l.map(w => [w]), map: l => new Map(l.map((w, i) => [i, w])), entries: l => Object.entries(Object.fromEntries(l.map((w, i) => ["k" + i, w]))) };
function codes_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; } return h + s; }
function codes_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; } return h + s; }
function codes_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; } return h + s; }
function codes_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; }); return h + s; }
function codes_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { for (let i = 0; i < (w as string).length; i++) h = (h * 31 + (w as string).charCodeAt(i)) | 0; } return h + s; }
function codes_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (let i = 0; i < w!.length; i++) h = (h * 31 + w!.charCodeAt(i)) | 0; } return h + s; }
function codes_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; } return h + s; }
function chars_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (let i = 0; i < w.length; i++) s += w.charAt(i); } return h + s; }
function chars_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; for (let i = 0; i < w.length; i++) s += w.charAt(i); } return h + s; }
function chars_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; for (let i = 0; i < w.length; i++) s += w.charAt(i); } return h + s; }
function chars_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { for (let i = 0; i < w.length; i++) s += w.charAt(i); }); return h + s; }
function chars_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { for (let i = 0; i < (w as string).length; i++) s += (w as string).charAt(i); } return h + s; }
function chars_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (let i = 0; i < w!.length; i++) s += w!.charAt(i); } return h + s; }
function chars_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { for (let i = 0; i < w.length; i++) s += w.charAt(i); } return h + s; }
function length_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w.length; } return h + s; }
function length_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; h += w.length; } return h + s; }
function length_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; h += w.length; } return h + s; }
function length_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { h += w.length; }); return h + s; }
function length_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { h += (w as string).length; } return h + s; }
function length_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w!.length; } return h + s; }
function length_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { h += w.length; } return h + s; }
function index_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w.indexOf("a"); } return h + s; }
function index_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; h += w.indexOf("a"); } return h + s; }
function index_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; h += w.indexOf("a"); } return h + s; }
function index_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { h += w.indexOf("a"); }); return h + s; }
function index_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { h += (w as string).indexOf("a"); } return h + s; }
function index_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w!.indexOf("a"); } return h + s; }
function index_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { h += w.indexOf("a"); } return h + s; }
function slice_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w.slice(1, 3); } return h + s; }
function slice_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; s += w.slice(1, 3); } return h + s; }
function slice_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; s += w.slice(1, 3); } return h + s; }
function slice_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { s += w.slice(1, 3); }); return h + s; }
function slice_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { s += (w as string).slice(1, 3); } return h + s; }
function slice_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w!.slice(1, 3); } return h + s; }
function slice_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { s += w.slice(1, 3); } return h + s; }
function starts_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { if (w.startsWith("w")) h++; else h += 10; } return h + s; }
function starts_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; if (w.startsWith("w")) h++; else h += 10; } return h + s; }
function starts_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; if (w.startsWith("w")) h++; else h += 10; } return h + s; }
function starts_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { if (w.startsWith("w")) h++; else h += 10; }); return h + s; }
function starts_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { if ((w as string).startsWith("w")) h++; else h += 10; } return h + s; }
function starts_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { if (w!.startsWith("w")) h++; else h += 10; } return h + s; }
function starts_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { if (w.startsWith("w")) h++; else h += 10; } return h + s; }
function upper_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w.toUpperCase(); } return h + s; }
function upper_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; s += w.toUpperCase(); } return h + s; }
function upper_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; s += w.toUpperCase(); } return h + s; }
function upper_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { s += w.toUpperCase(); }); return h + s; }
function upper_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { s += (w as string).toUpperCase(); } return h + s; }
function upper_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w!.toUpperCase(); } return h + s; }
function upper_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { s += w.toUpperCase(); } return h + s; }
function split_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w.split("o").length; } return h + s; }
function split_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; h += w.split("o").length; } return h + s; }
function split_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; h += w.split("o").length; } return h + s; }
function split_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { h += w.split("o").length; }); return h + s; }
function split_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { h += (w as string).split("o").length; } return h + s; }
function split_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w!.split("o").length; } return h + s; }
function split_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { h += w.split("o").length; } return h + s; }
function trim_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w.trim() + "|"; } return h + s; }
function trim_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; s += w.trim() + "|"; } return h + s; }
function trim_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; s += w.trim() + "|"; } return h + s; }
function trim_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { s += w.trim() + "|"; }); return h + s; }
function trim_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { s += (w as string).trim() + "|"; } return h + s; }
function trim_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w!.trim() + "|"; } return h + s; }
function trim_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { s += w.trim() + "|"; } return h + s; }
function pad_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w.padStart(4, "-"); } return h + s; }
function pad_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; s += w.padStart(4, "-"); } return h + s; }
function pad_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; s += w.padStart(4, "-"); } return h + s; }
function pad_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { s += w.padStart(4, "-"); }); return h + s; }
function pad_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { s += (w as string).padStart(4, "-"); } return h + s; }
function pad_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w!.padStart(4, "-"); } return h + s; }
function pad_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { s += w.padStart(4, "-"); } return h + s; }
function at_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w[0]; h += w.length; } return h + s; }
function at_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; s += w[0]; h += w.length; } return h + s; }
function at_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; s += w[0]; h += w.length; } return h + s; }
function at_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { s += w[0]; h += w.length; }); return h + s; }
function at_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { s += (w as string)[0]; h += (w as string).length; } return h + s; }
function at_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { s += w![0]; h += w!.length; } return h + s; }
function at_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { s += w[0]; h += w.length; } return h + s; }
function includes_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { if (w.includes("r")) h += 3; } return h + s; }
function includes_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; if (w.includes("r")) h += 3; } return h + s; }
function includes_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; if (w.includes("r")) h += 3; } return h + s; }
function includes_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { if (w.includes("r")) h += 3; }); return h + s; }
function includes_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { if ((w as string).includes("r")) h += 3; } return h + s; }
function includes_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { if (w!.includes("r")) h += 3; } return h + s; }
function includes_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { if (w.includes("r")) h += 3; } return h + s; }
function both_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w.length + w.charCodeAt(0); } return h + s; }
function both_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; h += w.length + w.charCodeAt(0); } return h + s; }
function both_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; h += w.length + w.charCodeAt(0); } return h + s; }
function both_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { h += w.length + w.charCodeAt(0); }); return h + s; }
function both_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { h += (w as string).length + (w as string).charCodeAt(0); } return h + s; }
function both_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { h += w!.length + w!.charCodeAt(0); } return h + s; }
function both_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { h += w.length + w.charCodeAt(0); } return h + s; }
function ofIt_pattern(pairs: [number, string][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (const c of w) s += c; } return h + s; }
function ofIt_written(pairs: [number, string][]): string { let h = 0, s = ""; for (const p of pairs) { const w = p[1]; for (const c of w) s += c; } return h + s; }
function ofIt_index(pairs: [number, string][]): string { let h = 0, s = ""; for (let q = 0; q < pairs.length; q++) { const [k, w] = pairs[q]!; for (const c of w) s += c; } return h + s; }
function ofIt_each(pairs: [number, string][]): string { let h = 0, s = ""; pairs.forEach(([k, w]) => { for (const c of w) s += c; }); return h + s; }
function ofIt_union(pairs: (string | number)[]): string { let h = 0, s = ""; for (const w of pairs) { for (const c of (w as string)) s += c; } return h + s; }
function ofIt_optional(pairs: [string, string | undefined][]): string { let h = 0, s = ""; for (const [k, w] of pairs) { for (const c of w!) s += c; } return h + s; }
function ofIt_first(pairs: [string, number][]): string { let h = 0, s = ""; for (const [w, n] of pairs) { for (const c of w) s += c; } return h + s; }
const forms: Record<string, (p: any) => any> = { codes_pattern, codes_written, codes_index, codes_each, codes_union, codes_optional, codes_first, chars_pattern, chars_written, chars_index, chars_each, chars_union, chars_optional, chars_first, length_pattern, length_written, length_index, length_each, length_union, length_optional, length_first, index_pattern, index_written, index_index, index_each, index_union, index_optional, index_first, slice_pattern, slice_written, slice_index, slice_each, slice_union, slice_optional, slice_first, starts_pattern, starts_written, starts_index, starts_each, starts_union, starts_optional, starts_first, upper_pattern, upper_written, upper_index, upper_each, upper_union, upper_optional, upper_first, split_pattern, split_written, split_index, split_each, split_union, split_optional, split_first, trim_pattern, trim_written, trim_index, trim_each, trim_union, trim_optional, trim_first, pad_pattern, pad_written, pad_index, pad_each, pad_union, pad_optional, pad_first, at_pattern, at_written, at_index, at_each, at_union, at_optional, at_first, includes_pattern, includes_written, includes_index, includes_each, includes_union, includes_optional, includes_first, both_pattern, both_written, both_index, both_each, both_union, both_optional, both_first, ofIt_pattern, ofIt_written, ofIt_index, ofIt_each, ofIt_union, ofIt_optional, ofIt_first };
for (let turn = 0; turn < 2; turn++) for (const g of Object.keys(given)) for (const p of Object.keys(shaped)) for (const n of Object.keys(forms)) { log = ""; let r: any; try { r = forms[n]!(shaped[p]!(given[g]!())); } catch (e: any) { r = "! " + e?.constructor?.name + (all ? " " + e?.message : ""); } say([g, p, n, r, log].join(" ")); }
console.log("lines", lines, hash);
