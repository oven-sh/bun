// Texts built of narrow and wide pieces in every order and length, read while they grow, rolled back by throws, and longer than the limits of the builder.
const pieces: string[] = ["a", "é", "日", "本語", "😀", "\ud83d", "\ude00", "", "ab", "word ", "日".repeat(63), "日".repeat(64), "日".repeat(65), "x".repeat(200), "ÿ", ("x日本y").slice(1, 3), "é日".slice(0, 1)];
let digest = 0;
const add = (text: string) => { for (let i = 0; i < text.length; i += 1 + (text.length >> 10)) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0; digest = (digest + text.length) | 0; };
let seed = 7;
const draw = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
function copy(s: string): string { let out = ""; for (let k = 0; k < s.length; k++) out += s[k]; return out; }
function copyIf(s: string): string { let out = ""; for (let k = 0; k < s.length; k++) if (s[k] !== "a") out += s[k]; return out; }
function copyAt(s: string): string { let out = ""; for (let k = 0; k < s.length; k++) out += s.charAt(k) + (k & 1 ? "" : "-"); return out; }
function copyOf(s: string): string { let out = ""; for (const c of s) out += c; return out; }
function escape(s: string): string { let out = ""; for (const c of s) { if (c === "a") out += "&amp;"; else if (c === "日") out += "sun"; else out += c; } return out; }
function join(list: string[], n: number, step: number): string { let out = ""; for (let i = 0; i < n; i++) out += list[(i * step) % list.length]!; return out; }
function joinBoth(list: string[], n: number): string { let out = ""; for (let i = 0; i < n; i++) { out += list[i % list.length]! + i; if (i % 7 === 3) out += `<${list[(i + 3) % list.length]}>`; } return out; }
function readWhile(list: string[], n: number): number { let out = "", r = 0; for (let i = 0; i < n; i++) { out += list[i % list.length]!; if (i % 5 === 0) r = (r * 7 + out.length + out.charCodeAt(out.length >> 1)) | 0; if (out === "日本語") r++; } return r; }
function inner(list: string[], n: number): string { let all = ""; for (let i = 0; i < n; i++) { let part = ""; for (let k = 0; k < i % 5; k++) part += list[(i + k) % list.length]!; all += part; if (part.length > 100) all += "|"; } return all; }
function thrown(list: string[], n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { out += list[i % list.length]!; if (i % 11 === 10) throw new Error(out.slice(-2)); out += "日"; } catch (error: any) { out += error.message; } } return out; }
function converted(n: number): string { const odd = { toString() { if (n % 3 === 0) throw new RangeError("odd"); return "語"; } }; let out = ""; for (let i = 0; i < n; i++) out += "日" + i + (i % 4 === 0 ? odd : "x"); return out; }
function codes(n: number): string { let out = ""; for (let i = 0; i < n; i++) out += String.fromCharCode(0x41 + (i % 26), 0x4e00 + (i % 100)) + String.fromCodePoint(0x1f600 + (i % 40)); return out; }
function cells(line: string): string[] { const out: string[] = []; let cell = ""; for (let k = 0; k < line.length; k++) { const c = line[k]!; if (c === " ") { out.push(cell); cell = ""; } else cell += c; } out.push(cell); return out; }
for (let round = 0; round < 3; round++) {
  for (const s of pieces) { add(copy(s)); add(copyIf(s)); add(copyAt(s)); add(copyOf(s)); add(escape(s)); for (const c of cells(s + " " + s + " 日 a")) add(c); }
  for (const n of [0, 1, 2, 5, 17, 40, 130, 700]) {
    for (const step of [1, 3, 5]) add(join(pieces, n, step));
    add(joinBoth(pieces, n)); digest = (digest + readWhile(pieces, n)) | 0; add(inner(pieces, n)); add(thrown(pieces, n)); add(codes(n));
    try { add(converted(n)); } catch (error: any) { add(error.message); }
  }
  for (let k = 0; k < 60; k++) { const list: string[] = []; for (let i = 0; i < 1 + draw(6); i++) list.push(pieces[draw(pieces.length)]!); add(join(list, draw(400), 1)); add(copy(join(list, draw(40), 1))); }
  console.log(round, digest);
}
const long = join(["日", "narrow", "本", "x"], 12000, 1), longer = join(["日本語", "a"], 60000, 1);
add(long); add(longer); add(copy(long)); add(copy(longer.slice(0, 20000)));
console.log(long.length, longer.length, long.charCodeAt(5000), longer.indexOf("語a日"), copy(long) === long, digest);
console.log(JSON.stringify(copy("a日b")), JSON.stringify(copyOf("😀x\ud83d")), copyIf("aaa") === "", JSON.stringify(cells("日 本語 x")));
