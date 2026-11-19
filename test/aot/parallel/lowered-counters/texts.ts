// Counters that start at the length of a text and are lowered: every step, joins by continue, the text exchanged on the way, positions below zero and above the length.
const texts = ["", "a", "  ab  ", "key=value;", "日本語", "été", "😀x", "x".repeat(33) + " ", "path/to/file.txt", "a,b,,c,"];
const ropes = (a: string, b: string) => a + "-" + b;
let digest = 0;
const add = (v: unknown) => { const t = String(v) + (Object.is(v, -0) ? "!" : ""); for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
function codes(s: string): number { let r = 0; for (let k = s.length - 1; k >= 0; k--) r = (r * 3 + s.charCodeAt(k)) & 0xfffff; return r; }
function points(s: string): number { let r = 0; for (let k = s.length - 1; k >= 0; --k) r = (r * 3 + (s.codePointAt(k) ?? 7)) & 0xfffff; return r; }
function atEnd(s: string): number { let r = 0; for (let k = s.length; k >= 0; k--) r = (r * 3 + s.charCodeAt(k)) & 0xfffff; return r; }
function outside(s: string): number { let n = 0; for (let k = s.length; k >= -2; k--) { const c = s.charCodeAt(k); if (c !== c) n++; else n += c; } return n; }
function pairs(s: string): number { let r = 0; for (let k = s.length - 1; k >= 1; k -= 2) r = (r * 5 + s.charCodeAt(k) * 2 + s.charCodeAt(k - 1)) | 0; return r; }
function ahead(s: string): number { let r = 0; for (let k = s.length - 1; k >= 0; k--) r = (r + s.charCodeAt(k + 1)) | 0; return r; }
function raised(s: string): number { let r = 0, n = 0; for (let k = s.length - 1; k >= 0; k--) { r = (r * 3 + s.charCodeAt(k)) & 0xfffff; if (n++ < 3 && s[k] === "a") k += 2; } return r; }
function joined(s: string): string { let out = ""; for (let k = s.length - 1; k >= 0; k--) { if (s[k] === " ") continue; if (s.charCodeAt(k) === 46) { k -= 1; continue; } out += s[k]; } return out; }
function trimmed(s: string): string { let k = s.length; while (k > 0 && s[k - 1] === " ") k--; return s.slice(0, k); }
function counted(s: string): number { let k = s.length, r = 0; while (k--) r = (r * 3 + s.charCodeAt(k)) & 0xfffff; return r; }
function other(s: string, t: string): number { let r = 0; for (let k = s.length - 1; k >= 0; k--) r = (r * 3 + t.charCodeAt(k)) & 0xfffff; return r; }
function exchanged(s: string, t: string): number { let r = 0; for (let k = s.length - 1; k >= 0; k--) { r = (r * 3 + s.charCodeAt(k)) & 0xfffff; if (k === 4) s = t; } return r; }
function nested(list: string[]): number { let r = 0; for (const s of list) for (let k = s.length - 1; k >= 0; k--) for (let j = k; j >= 0; j--) r = (r * 3 + s.charCodeAt(j)) & 0xfffff; return r; }
function last(s: string, c: string): number { for (let k = s.length - 1; k >= 0; k--) if (s.charAt(k) === c) return k; return -1; }
function element(s: string): number { let n = 0; for (let k = s.length - 1; k >= 0; k--) { const c = s[k]; if (c === undefined) n += 100; else if (c < "b") n += k; } return n; }
function* steps(s: string): Generator<number> { for (let k = s.length - 1; k >= 0; k--) yield s.charCodeAt(k); }
function tried(s: string): number { let r = 0, k = s.length - 1; while (k >= 0) { try { if (k === 2) throw k; r = (r * 3 + s.charCodeAt(k)) & 0xfffff; k--; } catch { k -= 2; r++; } } return r; }
function wide(s: string, by: number): number { let r = 0; for (let k = s.length - 1; k >= 0; k -= by) r = (r * 3 + s.charCodeAt(k)) & 0xfffff; return r; }
function list(a: { length: number; charCodeAt(i: number): number } | string): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) r = (r * 3 + a.charCodeAt(k)) & 0xfffff; return r; }
class Walker { total = 0; walk(s: string): void { for (let k = s.length - 1; k >= 0; k--) this.total = (this.total * 3 + s.charCodeAt(k)) % 1000003; } }
const walker = new Walker();
for (let turn = 0; turn < 60; turn++) {
  for (const a of texts) {
    for (const s of [a, a.slice(1), ropes(a, texts[turn % texts.length]!)]) {
      add(codes(s)); add(points(s)); add(atEnd(s)); add(outside(s)); add(pairs(s)); add(ahead(s)); add(raised(s)); add(joined(s)); add(trimmed(s)); add(counted(s));
      add(other(s, a)); add(other(a, s)); add(exchanged(s, a)); add(last(s, "a")); add(element(s)); add(tried(s)); add([...steps(s)].join()); walker.walk(s);
      add(wide(s, 1 + (turn & 3))); add(wide(s, 0.5)); add(list(s));
    }
  }
  add(nested(texts)); add(list({ length: 5, charCodeAt: i => i * 7 }));
}
add(walker.total);
console.log(digest, walker.total, nested(texts), codes("abc"), outside("abc"), raised("banana"), exchanged("banana split", "x"));
