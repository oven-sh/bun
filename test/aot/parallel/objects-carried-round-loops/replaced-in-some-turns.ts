// A loop carries an object that only some of its turns replace: one arm hands on the old one, another a new one, a third one out of two.
type Q = { v: any; w: any };
const make = (v: any, w: any): Q => ({ v, w });
class P { v: any; w: any; constructor(v: any, w: any) { this.v = v; this.w = w; } }
class P3 extends P { u = 1; }
const kept: any[] = [];
const starts: any[] = [0, -0, 0.5, 2147483647, "s", null, undefined, true, 3n, NaN];
const loops: Record<string, (start: any, n: number) => any> = {
  odd(start, n) { let q = make(start, 1), t = ""; for (let i = 0; i < n; i++) { t += q.v + ":" + q.w + " "; if (i & 1) q = make(i, q.v); } return t; },
  best(start, n) { let best = make(-1, -1), s = 0; for (let i = 0; i < n; i++) { const x = (i * 37) % 11; if (x > best.v) best = make(x, i); s += best.w; } return s + ":" + best.v; },
  resets(start, n) { let z = { re: 0, im: 0 }, t = 0; for (let i = 0; i < n; i++) { z = { re: z.re * z.re - z.im * z.im - 0.4, im: 2 * z.re * z.im + 0.6 }; if (z.re * z.re + z.im * z.im > 1) { z = { re: 0, im: 0 }; t++; } } return t + ":" + z.re.toFixed(5) + ":" + z.im.toFixed(5); },
  three(start, n) { let q = make(0, "a"), t = ""; for (let i = 0; i < n; i++) { if (i % 3 === 0) q = make(i, "b"); else if (i % 3 === 1) q = make(q.v + 1, "c"); t += q.w + q.v; } return t; },
  parses(start, n) { const text = "12 345 6 "; let total = 0; for (let k = 0; k < n; k++) { let r = { pos: 0, value: 0 }; while (r.pos < text.length) { if (text[r.pos] === " ") { total += r.value; r = { pos: r.pos + 1, value: 0 }; } else r = { pos: r.pos + 1, value: r.value * 10 + text.charCodeAt(r.pos) - 48 }; } } return total; },
  chooses(start, n) { let a = make(1, 2), b = make(3, 4), t = ""; for (let i = 0; i < n; i++) { const c = i & 1 ? a : b; t += c.v + "" + c.w + " "; if (i % 3 === 0) a = c; else b = make(c.w, i); } return t + a.v + b.v; },
  keepsOne(start, n) { let q = make(0, 0), t = ""; kept.length = 0; for (let i = 0; i < n; i++) { if (i === 2) kept.push(q); if (kept.length && i === 4) kept[0].v = "changed"; t += q.v + " "; if (i % 5 === 4) q = make(i, 1); } return t + JSON.stringify(kept); },
  same(start, n) { let q = make(0, 0), old = q, t = ""; for (let i = 0; i < n; i++) { t += q === old ? "=" : "#"; old = q; if (i & 2) q = make(q.v + 1, i); } return t + q.v; },
  classes(start, n) { let q: P = new P(1, 2), t = ""; for (let i = 0; i < n; i++) { t += q.v + (q instanceof P3 ? "!" : "."); if (i % 3 === 0) q = new P3(i, q.w); else if (i % 3 === 1) q = new P(q.w, i); } return t; },
  layouts(start, n) { let q: any = { v: 1, w: 2 }, t = ""; for (let i = 0; i < n; i++) { t += q.v + ":" + q.w + " "; if (i & 1) q = { w: i, v: q.v }; else if (i & 2) q = { v: i }; } return t; },
  written(start, n) { let q = make(0, 0), t = 0; for (let i = 0; i < n; i++) { if (i & 1) q.v += 2; else q = make(q.v, i); t += q.v + q.w; } return t; },
  continues(start, n) { let q = make(0, 0), t = ""; for (let i = 0; i < n; i++) { if (i % 4 === 1) { q = make(i, t.length); continue; } if (i % 4 === 2) continue; t += q.v + "" + q.w; } return t; },
  breaks(start, n) { let q = make(start, 0); for (let i = 0; ; i++) { if (i >= n) break; if (i & 1) q = make(q.w, i); else if (i === 6) break; } return String(q.v) + q.w; },
  switches(start, n) { let q = make(0, "x"), t = ""; for (let i = 0; i < n; i++) { switch (i % 4) { case 0: q = make(i, "p"); break; case 1: t += q.w; break; case 2: q = make(q.v, q.w + "q"); default: t += q.v; } } return t + q.w; },
  inner(start, n) { let q = make(0, 0), t = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) { if (j === i % 3) q = make(q.v + j, q.w + 1); t += q.v; } if (i & 1) q = make(t % 7, q.w); } return t + ":" + q.w; },
  short(start, n) { let q: Q | null = make(0, 0), t = 0; for (let i = 0; i < n; i++) { q = q && i % 3 ? make(q.v + 1, i) : q || make(100, 0); t += q.v; if (i === 5) q = null; } return t; },
  conditional(start, n) { let q = make(start, 1), t = ""; for (let i = 0; i < n; i++) { q = i & 1 ? make(i, q.v) : i & 2 ? q : make(q.w, q.v); t += String(q.v) + String(q.w); } return t; },
  thrown(start, n) { let q = make(0, 0), t = 0; for (let i = 0; i < n; i++) { try { if (i % 3 === 2) throw q; q = make(q.v + 1, i); } catch (e: any) { t += e.v + (e === q ? 1 : 0); if (i & 1) q = make(0, i); } } return t + q.v; },
  finals(start, n) { let q = make(0, 0), t = ""; for (let i = 0; i < n; i++) { try { if (i & 1) q = make(i, q.v); if (i % 3 === 0) continue; } finally { t += q.v + "" + q.w; } } return t; },
  closures(start, n) { const fs: (() => any)[] = []; let q = make(0, 0); for (let i = 0; i < n; i++) { const held = q; if (i % 3 === 0) fs.push(() => held.v); if (i & 1) q = make(i, 0); } return fs.map(f => f()).join(); },
};
const show = (value: any): string => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value).slice(0, 140);
for (const name of Object.keys(loops)) {
  const line: string[] = [];
  for (const n of [0, 1, 2, 7, 23]) {
    for (const start of name === "odd" || name === "breaks" || name === "conditional" ? starts : [0]) {
      try { line.push(show(loops[name](start, n))); } catch (e) { line.push((e as Error).name); }
    }
  }
  console.log(name, line.join(" | "));
}
