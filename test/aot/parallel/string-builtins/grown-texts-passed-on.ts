// A text that a loop grows and passes to functions that look at its length, read its characters, keep it, throw, and grow it too; and flat strings that share what was grown.
const wide = "日";
let digest = 0;
const add = (text: string) => {
  digest = (Math.imul(digest, 31) + text.length) | 0;
  for (let i = 0; i < text.length; i += 1 + (text.length >> 4)) digest = (Math.imul(digest, 33) + text.charCodeAt(i)) | 0;
};
const kept: string[] = [];
const readers: ((s: string) => number)[] = [
  s => s.length,
  s => s.charCodeAt(s.length - 1),
  s => s.charCodeAt(0) + s.charCodeAt(s.length >> 1),
  s => s.indexOf("zz"),
  s => (kept.length < 4000 ? kept.push(s) : 0),
  s => (s + "!").charCodeAt(s.length),
  s => { const t = s + s.slice(0, 3); return t.charCodeAt(t.length - 1); },
  s => (s === "ababab" ? 1 : 0),
  s => Number(new Map([[s, s.length]]).get(s)),
  s => s.lastIndexOf("a"),
];
function pass(s: string, k: number): number { return readers[k](s); }
function look(s: string): number { try { if (s.length % 97 === 96) throw new Error(s.slice(-3)); return s.length & 7; } catch (error: any) { return error.message.charCodeAt(2); } finally { digest = (digest + 1) | 0; } }
function grow(n: number, piece: string, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += piece; digest = (digest + pass(s, k)) | 0; } return s; }
function growBoth(n: number, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "x"; digest = (digest + readers[k](s)) | 0; s += i; } return s; }
function growFront(n: number, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s = "x" + s; digest = (digest + readers[k](s)) | 0; } return s; }
function growTry(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "ab"; digest = (digest + look(s)) | 0; } return s; }
function growBranch(n: number, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "ab"; if (i % 5 === 0) digest = (digest + readers[k](s)) | 0; if (i % 701 === 700) s = ""; } return s; }
function fork(n: number, k: number): string { let s = "start".repeat(120), t = ""; for (let i = 0; i < n; i++) { digest = (digest + readers[k](s)) | 0; const u = s + "u" + i; t = s + "t" + i; digest = (digest + readers[k](u) + readers[k](t)) | 0; s = i & 1 ? u : t; if (s.length > 3000) s = s.slice(0, 600); } return s + t; }
function returned(n: number, k: number): string { const f = (s: string) => s + "a"; let s = ""; for (let i = 0; i < n; i++) { s = f(s); if (k) digest = (digest + readers[k](s)) | 0; } return s; }
function growThree(n: number, piece: string, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "d"; s += piece; s += i & 7; digest = (digest + readers[k](s)) | 0; } return s; }
function growSix(n: number, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "d"; s += i; s += "e"; s += "f"; s += i & 1 ? "" : "g"; s += "h"; digest = (digest + readers[k](s)) | 0; } return s; }
function turnsWide(n: number, k: number): string { let s = ""; for (let i = 0; i < n; i++) { s += i < n - 40 ? "narrow" : wide; digest = (digest + readers[k](s)) | 0; } return s; }
function shrinks(n: number, k: number): string { let s = "x".repeat(900); for (let i = 0; i < n; i++) { s += "ab"; digest = (digest + readers[k](s)) | 0; if (i % 50 === 49) s = s.slice(i % 100 === 99 ? 2 : 0, -60); if (i % 130 === 129) s = s.slice(40); } return s; }
const field = { s: "" };
function inField(n: number, k: number): string { field.s = ""; for (let i = 0; i < n; i++) { field.s += "ab"; digest = (digest + readers[k](field.s)) | 0; } return field.s; }
for (let k = 0; k < readers.length; k++) {
  for (const n of [1, 3, 40, 130, 700, 1500]) {
    add(grow(n, "ab", k));
    add(grow(n, "", k));
    add(grow(n >> 2, "a piece of seventeen", k));
    add(grow(n >> 1, "ÿ", k));
    add(growBoth(n, k));
    add(growBranch(n, k));
    add(returned(n, k));
    add(inField(n, k));
    add(growThree(n >> 1, "ab", k));
    add(growThree(n >> 1, wide, k));
    add(growSix(n >> 2, k));
    add(turnsWide(n >> 1, k));
    add(shrinks(n, k));
    if (n < 800) { add(grow(n, wide, k)); add(growFront(n, k)); add(fork(n, k)); }
  }
  console.log(k, digest, kept.length);
}
add(growTry(2000));
add(grow(20000, "ab", 1));
add(grow(5000, "abc", 6));
let check = 0;
for (let i = 0; i < kept.length; i++) { add(kept[i]); if (i && kept[i].length > kept[i - 1].length && kept[i].startsWith(kept[i - 1])) check++; }
console.log(digest, kept.length, check);
