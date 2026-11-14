// Maps and sets of every size class: lookups, has then get, deletes, growth, keys and values that widen their columns.
declare const process: { readonly argv: readonly string[] };
class K { constructor(public v: number) {} toString() { return "K" + this.v; } }
const most = 1200; const objects: K[] = []; for (let i = 0; i < most; i++) objects.push(new K(i)); const symbols: symbol[] = []; for (let i = 0; i < most; i++) symbols.push(Symbol("s" + i));
function keyOf(i: number): any { return (i % 5 === 0 ? "s" + i : i % 5 === 1 ? i : i % 5 === 2 ? objects[i]! : i % 5 === 3 ? i + 0.25 : i & 8 ? null : undefined) as any; } function valueOf(i: number): any { return (i % 3 === 0 ? objects[i]! : i % 3 === 1 ? i : "t" + i) as any; }
let line = ""; function say(v: unknown): void { line += (Object.is(v, -0) ? "-0" : typeof v === "symbol" ? v.description : String(v)) + " "; }
function fill(n: number): Map<any, any> { const m = new Map<any, any>(); for (let i = 0; i < n; i++) m.set(keyOf(i), valueOf(i)); return m; }
function gets(m: Map<any, any>, list: any[]): string { let s = 0; for (const k of list) { const v = m.get(k); if (v !== undefined) s = (s * 31 + String(v).length + (typeof v === "number" ? v | 0 : 1)) | 0; else s = (s * 17 + 3) | 0; } return String(s); }
function hasThenGets(m: Map<any, any>, list: any[]): string { let s = 0; for (const k of list) if (m.has(k)) { const v = m.get(k)!; s = (s * 31 + String(v).length) | 0; } else s = (s + 7) | 0; return String(s); }
function members(set: Set<any>, list: any[]): number { let s = 0; for (const k of list) s = (s * 3 + (set.has(k) ? 1 : 2)) | 0; return s; }
const sizes: number[] = JSON.parse(process.argv[2] ?? "null") ?? [0, 1, 4, 5, 8, 9, 16, 64, 253, 254, 255, 256, 400, 1000];
for (const n of sizes) {
  const m = fill(n); const list: any[] = []; for (let i = 0; i < n + 5; i++) list.push(keyOf(i));
  say(n); say(m.size); say(gets(m, list)); say(hasThenGets(m, list)); for (let r = 0; r < 3; r++) say(gets(m, list));
  const set = new Set<any>(list.slice(0, n >> 1)); say(members(set, list)); say(set.size);
  for (let i = 0; i < n; i += 3) say(m.delete(keyOf(i))); say(m.size); say(gets(m, list)); say(hasThenGets(m, list));
  for (let i = 0; i < n; i += 3) m.set(keyOf(i), valueOf(i + 1)); say(gets(m, list)); for (let i = 0; i < n; i++) m.set(keyOf(i), valueOf(n - i)); say(gets(m, list));
  m.set(keyOf(0), "late" as any); say(gets(m, list)); m.set("extra" as any, valueOf(1)); m.set(0.125 as any, valueOf(2)); say(gets(m, list)); say(m.get("extra" as any)); say(m.get(0.125 as any)); say(m.get(-0 as any)); say(m.get(NaN as any)); m.set(NaN as any, valueOf(3)); m.set(-0 as any, valueOf(2)); say(m.get(NaN as any)); say(m.get(0 as any)); m.clear(); say(gets(m, list)); say(m.size);
  console.log(line); line = "";
}
