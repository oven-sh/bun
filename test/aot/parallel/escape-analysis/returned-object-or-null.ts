// A function returns an object or null, and a caller that tests the result and then only reads it needs no allocation.
declare const console: { log(...v: unknown[]): void };
function assertNotAllocated(_: unknown): void {}
const out: string[] = []; const say = (...v: unknown[]): void => { out.push(v.map(String).join(",")); };
function spin(x: number): number { return x < 2 ? x + 1 : spin(x - 1) + spin(x - 2) * 0.5; }
function find(x: number): { a: number, b: number } | undefined { if (x < 0) return undefined; if (x === 1) return; return { a: x, b: spin(x & 3) }; } //! heap: Return
function pos(x: number): [number, number] | null { if (x < 0) return null; return [x, spin(x & 3)]; }
function use1(x: number): number { const r = find(x); assertNotAllocated(r); if (!r) return -1; return r.a + r.b; }
function use2(x: number): number { const r = find(x); assertNotAllocated(r); if (r === undefined) return 0; const { a, b } = r; return a * b; }
function use3(x: number): number { const r = find(x); assertNotAllocated(r); return r ? r.a : 0; }
function use4(x: number): number { return find(x)?.a ?? 7; }
function use5(x: number): number { const r = find(x); assertNotAllocated(r); if (r != null) return r.b; return 1; }
function use6(x: number): number { const p = pos(x); assertNotAllocated(p); if (p === null) return -2; const [a, b] = p; return a - b; }
function use7(x: number): number { const p = pos(x); assertNotAllocated(p); if (p) { return p[0] + p[1]; } return -3; }
function use8(x: number): number { const r = find(x); assertNotAllocated(r); if (r !== undefined && r.a > 2) return r.b; return -4; }
function use9(x: number): string { const r = find(x); assertNotAllocated(r); return (r === null) + "," + (r === undefined) + "," + (r == null) + "," + !r; }
{ let t = 0; for (let i = -2; i < 6; i++) { t += use1(i) + use2(i) + use3(i) + use4(i) + use5(i) + use6(i) + use7(i) + use8(i); } say("read", t, use9(-1), use9(2)); }
// the same shapes of callees, with callers that need more: separate functions, so that the sites above stay `removed`
function find2(x: number): { a: number, b: number } | undefined { if (x < 0) return undefined; return { a: x, b: spin(x & 3) }; } //! heap
function pos2(x: number): [number, number] | null { if (x < 0) return null; return [x, spin(x & 3)]; } //! heap
function text(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
function bang(x: number): number { const r = find2(x); return r!.a; }
function early(x: number): number { const r = find2(x) as { a: number, b: number }; const a = r.a; if (!r) return -1; return a; }
function elsewhere(x: number, y: number): number { const r = find2(x); if (y > 0) { if (!r) return -1; } return (r as { a: number, b: number }).b; }
function tuple(x: number): number { const p = pos2(x) as [number, number]; return p[1]; }
say("thrown", text(() => bang(2)), text(() => bang(-1)), text(() => early(2)), text(() => early(-1)), text(() => elsewhere(2, 0)), text(() => elsewhere(-1, 0)), text(() => elsewhere(-1, 1)), text(() => tuple(3)), text(() => tuple(-3)));
const kept: unknown[] = [];
function keeps(x: number): number { const r = find2(x); kept.push(r); return r ? r.a : -1; }
function hands(x: number): { a: number, b: number } | undefined { return find2(x); }
function same(x: number): boolean { const r = find2(x); return r === r && find2(x) !== find2(x); }
function kinds(x: number): string { const r = find2(x); return typeof r + "," + JSON.stringify(r) + "," + String(pos2(x)); }
function loops(n: number): number { let t = 0, r = find2(n); while (r) { t += r.a; r = find2(r.a - 2); } return t; }
function orElse(x: number): number { const r = find2(x) ?? { a: -7, b: -8 }; return r.a + r.b; }
say("kept", keeps(3), keeps(-3), kept.length, kept[1], (kept[0] as any).b, hands(2)!.b, hands(-2), same(2), same(-2), kinds(2), kinds(-2), loops(7), orElse(2), orElse(-2));
// both kinds of null or undefined: nothing is done; by value; recursion
function either(x: number): { v: number } | undefined | null { if (x < 0) return undefined; if (x === 0) return null; return { v: spin(x & 3) }; }
function useEither(x: number): string { const r = either(x); if (r === undefined) return "u"; if (r === null) return "n"; return String(r.v); }
const table = [find, find2]; function byValue(i: number, x: number): number { const r = table[i](x); return r ? r.b : -9; }
function down(n: number): { depth: number } | undefined { if (n < 0) return undefined; const r = down(n - 1); if (!r) return { depth: 0 }; return { depth: r.depth + 1 }; } //! heap
say("more", useEither(-1), useEither(0), useEither(2), byValue(0, 2), byValue(1, -2), down(5)!.depth, down(-1));
console.log(out.join(" | "));
