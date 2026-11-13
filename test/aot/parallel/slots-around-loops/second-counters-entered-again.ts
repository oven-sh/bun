// A second counter beside the counter of a loop that is left and entered again: by caught throws, by iterations whose values change kind, by outer loops, generators, callbacks and recursion.
const lines: string[] = [];
const log = (name: string, value: unknown) => { lines.push(name + " " + String(value)); };
const jobs: (() => void)[] = [() => { lines.length; }];
class Point { v: any; constructor(v: any) { this.v = v; } }

function caught(k: number, at: number): string { const view = new Float64Array(16); let n = 0, s = 0; for (let i = 0; i < 8; i++) { try { s += view[n++] ?? 900; if (i === at) throw i; view[n] = i; } catch { n += k; } if (n > 50) s += 1000; if (n < 0) s += 10000; } return n + " " + s + " " + view.join("."); }
function finallyMoves(k: number, xs: any): string { const view = new Uint8Array(16); let n = 0, s: any = 0; for (let i = 0; i < 8; i++) { try { view[n++] = i + 1; s += xs[i]; if (xs[i] === 2) throw 1; } catch { s += 1; } finally { if (i === 3) n += k; } } return n + " " + s + " " + view.join("."); }
function outerCaught(k: number): string { const list: any[] = [1, 2, 3, 4, 5, 6, 7, 8]; let n = 0, s = 0, guard = 0, i = 0; outer: for (;;) { for (; i < list.length; i++) { try { s += list[n++] ?? 3; if (i === 2) throw i; } catch { n += k; i++; if (guard++ > 9) break outer; continue outer; } } break; } return n + " " + s; }
function kinds(xs: any, k: number): string { const out: any[] = [], text = "abcdefghij"; let n = 0, s: any = 0; for (let i = 0; i < 8; i++) { if (i === 2) { xs[i] = "a"; n += k; } s += xs[i]; s += text.charCodeAt(n) || 11; out[n++] = i; } return n + " " + s + " " + Object.keys(out).join("."); }
function objects(ys: any[], k: number): string { const view = new Int32Array(8); let n = 0, s = 0; for (let r = 0; r < 3; r++) { for (let i = 0; i < 8; i++) { s += ys[i].v; view[n++] = i; if (i === 3) ys[5] = { get v() { return 4; } }; } n += k; } return n + " " + s + " " + view.join("."); }
function unswitched(flag: boolean, k: number): string { const doubles = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]; let n = 0, s = 0, i = 0; while (i < 8) { for (; i < 8; i++) { if (flag) s += doubles[n++] ?? 3; else { doubles[n] = i; n++; } if (i === 4) { i++; break; } } n += k; jobs[0](); } return n + " " + s + " " + doubles.length; }
function growing(k: number): string { let n = 0, s = 0; for (let r = 0; r < 12; r++) { for (let i = 0; i < 8; i++) { n++; s += n > 2147483647 ? 1 : n < -2147483648 ? 100 : 10; s += (n | 0) === n ? 1 : 2; } n += k; } return n + " " + s; }
function captured(k: number): string { const view = new Uint8Array(16); let n = 0, s = 0; const inner = (m: number) => { for (let i = 0; i < 8; i++) { s += view[n++] ?? 9; if (n > 50) s += 1000; if (i === m) { n += k; return; } } }; inner(2); inner(9); for (let r = 0; r < 3; r++) inner(r); return n + " " + s; }
class Holder { n = 0; run(k: number, w: any[]): string { let s = 0; for (let r = 0; r < 3; r++) { for (let i = 0; i < w.length; i++) { s += w[this.n++] ?? 900; if (i === 5) { this.n += k; break; } } } return this.n + " " + s; } }
function* steps(k: number, w: Float64Array): Generator<number, number, any> { let n = 0, s = 0; for (let i = 0; i < 8; i++) { if (i === 2) n += (yield n) | 0; s += w[n++] ?? 900; if (n > 50) s += 1000; yield s; } return n + k; }
function consumed(k: number): string { const view = new Float64Array(16); let n = 0, s = 0, i = 0; for (const j of steps(k, view)) { s += j; view[n++] = j; if (i++ === 3) n += k; if (i > 30) break; } return n + " " + s + " " + view.join("."); }
function stepped(k: number): string { const it = steps(k, new Float64Array(16)); let s = "", move = 0; for (let i = 0; i < 12; i++) { const r = it.next(move); s += r.value + (r.done ? "!" : "") + " "; if (r.done) break; move = i === 2 ? k : 0; } return s; }
function tail(w: Float64Array, n: number, i: number, k: number, acc: number): number { if (i >= 8) return acc + n; if (i === 2) return tail(w, n + k, i + 1, k, acc); return tail(w, n + 1, i + 1, k, acc + (w[n] ?? 900)); }
function callee(w: Float64Array, m: number): number { let c = m; for (let j = 0; j < 4; j++) { w[c++] = j; if (j === 2) c += m; } return c; }
function inlined(k: number): string { const view = new Float64Array(16); let n = 0; for (let i = 0; i < 5; i++) { n = callee(view, n); if (i === 2) n += k; } return n + " " + view.join("."); }
function down(k: number): string { const view = new Uint8Array(16); let n = 15, s = 0; for (let r = 0; r < 2; r++) { for (let i = 7; i >= 0; i--) { s += view[n--] ?? 31; if (i === 5) { n -= k; } if (n < -40) s += 7; } n += 10; } return n + " " + s; }
function called(xs: number[], k: number): string { const view = new Float64Array(8); let n = 0, s = 0; xs.forEach((x, at) => { for (let j = 0; j < 8; j++) { s += view[n++] ?? 5; if (j === 3 && at === 1) n += k; } s += x; }); for (let i = 0; i < 4; i++) s += view[n++] ?? 5; return n + " " + s; }

for (const k of [0, 1, 5, 40, 100, -10, 2147483640, 4294967290, -3000000000]) {
  for (const at of [0, 3, 9]) log("caught " + k + " " + at, caught(k, at));
  log("finally " + k, finallyMoves(k, [3, 1, 2, 4, 1, 5, 9, 2]) + " " + finallyMoves(k, ["x", 1, 2.5, 4, 1, 5, 9, 2]));
  log("outer " + k, outerCaught(k));
  log("kinds " + k, kinds([3, 1, 2, 4, 1, 5, 9, 2], k));
  log("objects " + k, objects(Array.from({ length: 8 }, (_, i) => new Point(i)), k));
  log("unswitched " + k, unswitched(true, k) + " " + (Math.abs(k) < 1000 ? unswitched(false, k) : ""));
  log("growing " + k, growing(k));
  log("captured " + k, captured(k));
  log("holder " + k, new Holder().run(k, [1, 2, 3, 4, 5, 6, 7, 8]));
  log("consumed " + k, consumed(k));
  log("stepped " + k, stepped(k));
  log("tail " + k, tail(new Float64Array(16).fill(1), 0, 0, k, 0));
  log("inlined " + k, Math.abs(k) < 1000 ? inlined(k) : "");
  log("down " + k, down(k));
  log("called " + k, called([1, 2, 3], k));
}
console.log(lines.join("\n"));
