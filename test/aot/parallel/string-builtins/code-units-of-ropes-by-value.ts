// Code units and code points of ropes that a method receives: both widths, pairs across a join, positions outside, receivers that are no strings.
const parts = ["", "a", "bc", "value", "key=value;", "x".repeat(40), "é", "日本", "\ud83d", "\ude00", "😀", "\udc00\ud800", "0123456789".repeat(9)];
const positions: any[] = [0, 1, 2, 3, 5, 9, 40, 41, -1, -0, 0.5, 1.9, NaN, Infinity, 2 ** 31, 2 ** 32 + 1, "1", undefined, null, true];

class Reader {
  total = 0;
  unit(s: any, i: any): any { return s.charCodeAt(i); }
  point(s: any, i: any): any { return s.codePointAt(i); }
  last(s: string): void { const t = s.length > 3 ? s.slice(0, 3) + "..." : s; this.total = (this.total * 3 + t.length + (t.charCodeAt(t.length - 1) || 0)) % 1000003; }
  sum(a: any, b: any): number { const t = a + b; let n = 0; for (let k = 0; k <= t.length; k++) n = (n * 5 + (t.charCodeAt(k) || 1) + (t.codePointAt(k) ?? 2)) % 1000003; return n; }
  twice(a: any, b: any): string { const t = a + b; const first = t.charCodeAt(0), again = t.charCodeAt(0); return first === again || (first !== first && again !== again) ? t : "differs"; }
}
const reader = new Reader();
const show = (v: any) => (Object.is(v, -0) ? "-0" : String(v));
const lines: string[] = [];
for (const a of parts) {
  for (const b of parts) {
    for (const i of positions) {
      lines.push(show(reader.unit(a + b, i)), show(reader.point(a + b, i)), show(reader.unit(`${a}-${b}`, i)), show(reader.point((a + b).slice(1), i)), show(reader.unit((a + b + a).slice(1, -1) + b, i)));
    }
    reader.last(a + b);
    lines.push(String(reader.sum(a, b)), reader.twice(a, b) === a + b ? "same" : "other", String(reader.sum(a + b, b + a)));
  }
}
let deep = "";
for (let k = 0; k < 4000; k++) deep = k & 1 ? deep + parts[k % parts.length] : parts[k % parts.length] + deep;
lines.push(show(reader.unit(deep + "e", deep.length)), show(reader.point("\ud83d" + (deep + "e"), 0)), show(reader.unit(deep, 777)), String(deep.length));

const receivers: any[] = [{ charCodeAt: (i: any) => "own " + i, codePointAt: (i: any) => "point " + i }, new String("ab" + parts[3]), 12, true, [1, 2], null, undefined, Symbol("s")];
for (const r of receivers) {
  for (const read of ["unit", "point"] as const) {
    try { lines.push(show(reader[read](r, 1))); } catch (e) { lines.push((e as Error).name); }
  }
}
try { lines.push(show(reader.unit(parts[3] + parts[4], Symbol("i")))); } catch (e) { lines.push((e as Error).name); }
let asked = 0;
lines.push(show(reader.unit(parts[3] + parts[4], { valueOf() { asked++; return 2; } })), String(asked));
lines.push(show(reader.unit(parts[3] + parts[4], 2)), String(reader.total));
let digest = 0;
for (const line of lines) for (let k = 0; k < line.length; k++) digest = (Math.imul(digest, 31) + line.charCodeAt(k)) | 0;
console.log(lines.length, digest, lines.slice(-24).join(" "));
