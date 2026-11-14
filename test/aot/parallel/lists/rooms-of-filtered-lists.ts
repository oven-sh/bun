// The room of a filtered list is learned by its site: results of every length, of every kind at one site, that are kept, grown and changed, with collections in between.
const told = (v: unknown): string => (v === undefined ? "u" : Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, i) => (i in v ? told(v[i]) : "_")).join() + "]" : typeof v === "object" && v ? "{}" : String(v));
const ints: number[] = [], doubles: number[] = [], words: string[] = [], objects: { i: number }[] = [], mixed: any[] = [];
for (let i = 0; i < 90; i++) { ints.push(i); doubles.push(i + 0.5); words.push("w" + i); objects.push({ i }); mixed.push([i, "m", null, 0.5][i & 3]); }
const holes = ints.slice(0, 20); delete holes[3]; delete holes[7];
const out: string[] = []; let mix = 7; const note = (s: string) => { for (let i = 0; i < s.length; i++) mix = (Math.imul(mix, 31) + s.charCodeAt(i)) | 0; };
const kept: any[] = [];
function rising(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.filter(x => x < i % 91); s += r.length; kept[i & 15] = r; if (i % 100 === 99) note(told(r)); } return s; }
function falling(n: number) { let s = 0; for (let i = n; i > 0; i--) { const r = ints.filter(x => x * 6 < i); s += r.length; kept[i & 15] = r; r.push(0.5); (r as any).push("s"); if (i % 50 === 0) note(told(r)); } return s; }
function burst(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.filter(x => (i > 300 && i < 310 ? true : x < 2)); s += r.length; kept[i & 7] = r; if (i === 305 || i === 400) note(told(r)); } return s; }
function kinds(n: number) { const sources: any[] = [ints, doubles, words, objects, mixed, holes, [], [1], [0.5], ["a"]]; let s = 0; for (let i = 0; i < n; i++) { const l = sources[(i >> 4) % sources.length], r = l.filter((x: any, k: number) => k % (1 + (i & 3)) === 0); s += r.length; r[r.length] = i & 1 ? i : "t"; kept[i & 15] = r; if (i % 37 === 0) note(told(r)); } return s; }
function typed(n: number) { let s = 0; for (let i = 0; i < n; i++) { const a = doubles.filter(x => x > i % 60), b = words.filter(w => w.length === 2 + (i & 1)), c = objects.filter(o => o.i % 3 === 0), d = mixed.filter(Boolean), e = holes.filter(() => true); s += a.length + b.length + c.length + d.length + e.length; kept[i & 15] = [a, b, c, d, e]; if (i % 64 === 0) { note(told(a) + told(b) + told(d) + told(e)); if (typeof Bun !== "undefined") Bun.gc(true); } } return s; }
function nested(n: number) { let s = 0; for (let i = 0; i < n; i++) s += ints.filter(x => x < 12).filter(x => ints.filter(y => y < x).length > i % 12).length; return s; }
function own(n: number) { let t = ints.slice(0, 40), s = 0; for (let i = 0; i < n; i++) { t = t.filter(x => x !== i % 50); if (t.length < 5) t = ints.slice(0, 30 + (i % 20)); s += t.length; } note(told(t)); return s; }
function thrown(n: number) { let s = 0; for (let i = 0; i < n; i++) { try { s += ints.filter((x, k) => { if (k === 60 + (i % 40)) throw k; return x < 50; }).length; } catch (e) { s += e as number; } } return s; }
function thinned(n: number) { let s = 0; for (let i = 0; i < n; i++) { const t = ints.slice(0, 30); s += t.filter((x, k) => { if (k === 5) t.length = i % 25; return true; }).length; s += t.filter((x, k) => { if (k < 3) t.push(x); return true; }).length; } return s; }
for (let round = 0; round < 2; round++) for (const f of [rising, falling, burst, kinds, typed, nested, own, thrown, thinned]) out.push(f.name + " " + f(f === nested ? 60 : 600) + " " + mix);
out.push(told(kept.map(k => k.length)));
for (const line of out) console.log(line);
export {};
