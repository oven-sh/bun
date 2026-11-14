declare const Bun: any; const key = (w: boolean, i: number): unknown => (w ? i : "m" + i);
function fill(w: boolean, n: number): Set<unknown> { const s = new Set<unknown>(); for (let i = 0; i < n; i++) s.add(key(w, i)); return s; }
function cut(s: Set<unknown>, w: boolean, from: number, to: number): void { for (let i = from; i <= to; i++) s.delete(key(w, i)); }
function put(s: Set<unknown>, w: boolean, from: number, to: number): void { for (let i = from; i <= to; i++) s.add(key(w, i)); }
function take(it: Iterator<unknown>, n: number): string { const out: unknown[] = []; for (let i = 0; i < n; i++) out.push(it.next().value); return out.join() + " | "; }
function rest(it: Iterator<unknown>): string { const out: unknown[] = []; for (let s = it.next(); !s.done; s = it.next()) out.push(s.value); return out.join(); }
const rows: [string, (w: boolean) => string][] = [
  ["grown", w => { const s = fill(w, 60), it = s.values(), t = take(it, 3); cut(s, w, 3, 40); put(s, w, 100, 199); cut(s, w, 41, 59); cut(s, w, 100, 150); return t + rest(it); }],
  ["grown, collected", w => { const s = fill(w, 60), it = s.values(), t = take(it, 3); cut(s, w, 3, 40); put(s, w, 100, 199); cut(s, w, 41, 59); cut(s, w, 100, 150); Bun.gc(true); return t + rest(it); }],
  ["cleared", w => { const s = fill(w, 40), it = s.values(), t = take(it, 2); s.clear(); put(s, w, 200, 260); cut(s, w, 200, 240); return t + rest(it); }],
  ["cleared small", w => { const s = fill(w, 2), it = s.values(), t = take(it, 1); s.clear(); put(s, w, 7, 8); return t + rest(it); }],
  ["shrunk", w => { const s = fill(w, 200), it = s.values(), t = take(it, 2); cut(s, w, 1, 198); return t + rest(it); }],
  ["again", w => { const s = fill(w, 50), it = s.values(), t = take(it, 5); cut(s, w, 5, 45); put(s, w, 7, 7); cut(s, w, 2, 2); put(s, w, 2, 2); return t + rest(it); }],
  ["under", w => { const s = fill(w, 40), it = s.values(), t = take(it, 10); cut(s, w, 9, 30); return t + rest(it); }],
  ["two", w => { const s = fill(w, 48), a = s.values(), b = s.values(), t = take(a, 1) + take(b, 20); cut(s, w, 1, 35); return t + rest(a) + " | " + rest(b); }],
  ["collected", w => { const s = fill(w, 64), it = s.values(), t = take(it, 1); cut(s, w, 1, 40); Bun.gc(true); return t + rest(it); }],
  ["to the end", w => { const s = fill(w, 30), it = s.values(), t = take(it, 1); cut(s, w, 0, 29); return t + "[" + rest(it) + "] " + s.size; }],
  ["callback", w => { const s = fill(w, 64), out: unknown[] = []; s.forEach(m => { out.push(m); if (out.length === 1) cut(s, w, 1, 40); }); return out.join(); }],
  ["pairs", w => { const m = new Map<unknown, unknown>(); for (let i = 0; i < 64; i++) m.set(key(w, i), i); const it = m.entries(), t = take(it, 1); for (let i = 1; i <= 40; i++) m.delete(key(w, i)); return t + rest(it); }]];
for (const [name, run] of rows) for (const w of [true, false]) { let said: string; try { said = run(w); } catch (e) { said = "THROWN " + (e as Error).name; } console.log("SAID " + name + " " + w + " " + said); } export {};
