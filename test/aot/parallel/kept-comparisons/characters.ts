// Comparisons of characters and strings whose answer is kept in a variable and used more than once: branches, sums, fields, arguments, captured, narrowed operands that are used again.
const texts = ["", "a", " ", "a b", "  a  bb ", "key=value; x", "日本 語", "été a", "😀 x", "a\tb\nc", "word", "   ", "x".repeat(40) + " " + "y".repeat(40)];
const joined = texts.join("|") + "|tail", pieces = joined.split("|"), ropes = texts.map((t, k) => t.slice(0, k) + t.slice(k));
const notANumber: any = NaN;
class Scan { inWord = false; last = false; count = 0; see(space: boolean): void { this.last = space; if (!space) this.count++; } }
function words(s: string): number { let r = 0, inWord = false; for (let k = 0; k < s.length; k++) { const space = s[k] === " "; if (!space && !inWord) r++; inWord = !space; } return r; }
function wordsAt(s: string): number { let r = 0, inWord = false; for (let k = 0; k <= s.length; k++) { const space = s.charAt(k) === " "; if (!space && !inWord) r++; inWord = !space; } return r; }
function beyond(s: string): string { let out = ""; for (let k = -1; k <= s.length; k++) { const space = s[k] === " ", none = s[k] === undefined; out += space ? "s" : none ? "n" : "."; if (space) out += k; if (none) out += "!"; } return out; }
function several(s: string): number { let r = 0; for (let k = 0; k < s.length; k++) { const c = s[k], a = c === "a", b = c === "b", sp = c === " "; if (a) r += 1; if (b) r += 2; if (sp) r += 3; if (!a && !b && !sp) r += c!.charCodeAt(0); r = (r * 3 + (a ? 1 : 0) + Number(b) + +sp) % 1000003; } return r; }
function either(s: string): number { let r = 0, was = false; for (let k = 0; k < s.length; k++) { const c = s[k]!; const blank = c === " " || c === "\t" || c === "\n"; if (blank && !was) r += 1; else if (blank) r += 10; was = blank; r = (r * 3) % 1000003; } return r; }
function both(s: string): number { let r = 0; for (let k = 1; k < s.length; k++) { const same = s[k] === s[k - 1], first = s[k] === s[0]; if (same) r += 1; if (first) r += 2; r = (r * 3 + (same === first ? 5 : 7)) % 1000003; } return r; }
function not(s: string): number { let r = 0; for (let k = 0; k < s.length; k++) { const other = s[k] !== "a", loose = s[k] != " "; if (other && loose) r++; if (other || loose) r += 2; r = (r * 3 + Number(other) + Number(loose) * 2) % 1000003; } return r; }
function stored(s: string): string { const scan = new Scan(); const flags: boolean[] = []; for (const c of s) { const space = c === " "; scan.see(space); scan.inWord = !space; flags.push(space); } return scan.count + "." + scan.last + "." + scan.inWord + "." + flags.filter(Boolean).length; }
function captured(s: string): number { const fs: (() => boolean)[] = []; for (let k = 0; k < s.length && k < 9; k++) { const space = s[k] === " "; if (space) fs.unshift(() => space); else fs.push(() => space); } return fs.reduce((n, f) => n * 2 + (f() ? 1 : 0), 1); }
function narrowed(list: any[]): string { let out = ""; for (const v of list) { const isA = v === "a", empty = v === "", long = v === "key=value; x"; if (isA) out += v.length; if (empty) out += "<" + v + ">"; if (long) out += v.toUpperCase(); if (!isA && !empty && !long && typeof v === "string") out += v.length; out += isA || empty ? 1 : 0; } return out; }
function sliced(s: string): number { let r = 0; for (let k = 0; k + 2 <= s.length; k++) { const hit = s.slice(k, k + 2) === "a ", two = s.substring(k, k + 2) === "  "; if (hit) r += 1; if (two) r += 2; r = (r * 3 + (hit ? 1 : 0) + (two ? 1 : 0)) % 1000003; } return r; }
function numbers(list: any[]): string { let out = ""; for (const v of list) { const one = v === 1, nan = v === notANumber, zero = v === 0, t = v === true; if (one) out += "1"; if (zero) out += "z"; if (nan) out += "?"; if (t) out += "t"; out += one === zero ? "e" : "d"; } return out; }
const mixed: any[] = [...pieces, ...ropes, 0, -0, 1, NaN, true, null, undefined, {}, ["a"], new String("a"), Symbol.iterator, 1n];
for (let turn = 0; turn < 25; turn++) {
  let line = "";
  for (const s of [...texts, ...pieces, ...ropes]) line += [words(s), wordsAt(s), beyond(s), several(s), either(s), both(s), not(s), stored(s), captured(s), sliced(s)].join(",") + ";";
  line += narrowed(mixed) + numbers(mixed);
  if (turn === 0 || turn === 24) console.log(line);
}
