// Lists made of the characters of texts, written texts and patterns asked of substrings, and switches over texts of both widths.
const wide = "日本";
const long = "some words, key=value; 42 more words and a tail that goes on ";
const texts: string[] = ["", "a", "é", "ÿ", "abc", wide, "a" + wide, wide + "a", "😀", "\ud83d", "\ude00x", "x".repeat(40), (wide + "é").repeat(30), long, long.slice(5), long.slice(3, 9), long.slice(0, 10), (long + wide).slice(2, -1), (wide + long).slice(1), "alpha", "alpha beta", "beta", "42", "key=value", "gamma", "日本語", "key", ("xalphax").slice(1, 6), ("x" + wide + "語y").slice(1, 4), ("éalpha beta" + wide).slice(1, 11), "ab" + String(texts0()).slice(1)];
function texts0(): string { return "cdef"; }
let digest = 0;
const add = (text: unknown) => { const t = typeof text === "string" ? text : JSON.stringify(text); for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; digest = (digest + t.length) | 0; };
const count = (...args: string[]) => args.length * 7 + (args[0] ?? "").length;
function lists(list: string[]): void {
  for (const s of list) {
    add([...s]); add([1, ...s] as unknown[]); add([...s, ...s]); add([...s, 2] as unknown[]); add(["x", ...s, "y"]);
    add(Array.from(s)); add(Array.from(s, (c, k) => c + k)); add(Array.from(s, c => c.charCodeAt(0))); add(Array.from(s, function (this: unknown, c) { return typeof this + c; }));
    add(count(...s)); add(Math.max(0, ...[...s].map(c => c.codePointAt(0)!)));
    const made = [...s]; made.push("end"); made[0] = "first"; add(made); add([...s].reverse().join("")); add([...s].length);
    const numbers: unknown[] = [1.5, 2]; numbers.push(...s); add(numbers);
    try { add(Array.from(s, (c, k) => { if (k === 2) throw new Error(c); return c; })); } catch (error: any) { add("threw " + error.message); }
  }
}
function equal(list: string[]): number {
  let r = 0;
  for (const s of list) {
    if (s === "alpha") r += 1; if (s === "alpha beta") r += 2; if (s !== "42") r += 4; if (s === "key=value") r += 8; if (s === "") r += 16; if (s === "words") r += 32; if (s === "e words") r += 64; if (s === "日本語") r += 128; if (s === "é") r += 256;
    r = (Math.imul(r, 3) + s.length) | 0;
  }
  return r;
}
const asked: ((s: string) => boolean)[] = [s => s === "日", s => s === "日本", s => s === "é", s => s === "ÿé", s => s === "語日本", s => s === "alpha日", s => s === "a", s => s === "42", s => s === "key", s => s === "beta", s => s === "alpha", s => s === "alphab", s => s === "alpha b", s => s === "alpha be", s => s === "alpha beta", s => s === "日本語日本語日本語", s => s !== "日本語"];
const flat = (s: string): string => JSON.parse(JSON.stringify(s));
function askedOfAll(): number { let r = 0; const list = ["日", "日本", "é", "ÿé", "語日本", "alpha日", "a", "42", "key", "beta", "alpha", "alphab", "alpha b", "alpha be", "alpha beta", "日本語日本語日本語", "日本語", "日木", "b", "43", "kez", "betb", "alphx", "alphax", "alpha x", "alpha bx"]; for (const t of list) for (const s of [t, flat(t), ("x" + t).slice(1), (t + "y").slice(0, -1), ("日" + t + "本").slice(1, -1), flat("日" + t).slice(1), t.slice(0, 1) + t.slice(1), String([t])]) for (let k = 0; k < asked.length; k++) r = (Math.imul(r, 3) + (asked[k]!(s) ? k + 1 : 0)) | 0; return r; }
function kind(s: string): number { switch (s) { case "alpha": return 1; case "beta": return 2; case "gamma": return 3; case "42": return 4; case "é": return 5; case "key=value": return 6; case "": return 7; default: return 0; } }
function kindOfWide(s: string): number { switch (s) { case "日本": return 1; case "日本語": return 2; case "alpha": return 3; case "é日": return 4; case "ÿ": return 5; default: return 0; } }
function single(s: string): boolean { switch (s) { case "alpha": return true; default: return false; } }
function patterns(list: string[]): number {
  let r = 0;
  for (const s of list) {
    r = (Math.imul(r, 5) + (/^\d+$/.test(s) ? 1 : 0) + (/words/.test(s) ? 2 : 0) + (/[^\x00-\x7f]/.test(s) ? 4 : 0) + (/日/.test(s) ? 8 : 0) + s.search(/o/) * 16 + s.search(/\w+=/) * 64) | 0;
    if (/(\w+) (\w+)/.test(s)) add(RegExp.$1 + "|" + RegExp.lastMatch + "|" + (RegExp as any).leftContext + "|" + (RegExp as any).rightContext + "|" + RegExp.input);
    const m = /(\w)(\w*)/.exec(s); add(m ? m[0] + m[1] + m.index + m.input.length : "none");
    add(s.replace(/o/g, "0")); add(s.match(/\w+/g) ?? []);
  }
  return r;
}
for (let round = 0; round < 3; round++) {
  lists(texts);
  let kinds = 0; for (const s of texts) kinds = (Math.imul(kinds, 7) + kind(s) * 5 + kindOfWide(s) + (single(s) ? 100 : 0)) | 0;
  console.log(round, digest, equal(texts), kinds, patterns(texts));
}
let s = ""; for (let i = 0; i < 300; i++) { s += i % 7 === 3 ? "é" : "q"; if (i % 50 === 0) { add([...s]); add(Array.from(s, c => c)); } }
console.log(askedOfAll());
console.log(digest, kind(s), equal([s, s.slice(0, 5), s.slice(290)]));
const frozen = Object.freeze([...("abc")]); try { (frozen as any).push("x"); } catch (error: any) { console.log(error.name); }
console.log(JSON.stringify([..."ab"]), digest);
