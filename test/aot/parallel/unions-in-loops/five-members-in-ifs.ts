// A union of five members in loops: its objects come from literals, copies, JSON, proxies, accessors, and some are no members.
declare const process: { argv: string[] }; declare const structuredClone: any;
type T = { type: 'add'; f0: number; size: number } | { type: 'remove'; f1: number; size: number } | { type: 'move'; f2: number; size: number } | { type: 'rename'; f3: number; size: number } | { type: 'open'; f4: number; size: number };

const any = (x: unknown): T => x as T;
function other(t: any, i: number): unknown {
  switch (i % 24) {
    case 0: return JSON.parse(JSON.stringify(t));
    case 1: return { ...t };
    case 2: return Object.assign({}, t);
    case 3: { const o: any = {}; for (const k of Object.keys(t).reverse()) o[k] = t[k]; return o; }
    case 4: { const o = { ...t, more: 1 }; return o; }
    case 5: { const o = { ...t }; delete o.size; return o; }
    case 6: { const o = { ...t }; delete o.type; return o; }
    case 7: { const o = { ...t }; let n = 0; const was = t.type; Object.defineProperty(o, 'type', { get() { n++; return n % 2 ? was : 'other'; }, enumerable: true, configurable: true }); return o; }
    case 8: return new Proxy({ ...t }, {});
    case 9: return Object.create({ ...t });
    case 10: return Object.freeze({ ...t });
    case 11: return Object.assign(Object.create(null), t);
    case 12: return structuredClone(t);
    case 13: { class Box { type; size; f: number; constructor() { this.type = t.type; this.size = t.size; this.f = 1; } } return new Box(); }
    case 14: return { ...t, type: ('<' + t.type).slice(1) };
    case 15: return { ...t, type: t.type.slice(0, 1) + t.type.slice(1) };
    case 16: return { ...t, type: 7 };
    case 17: return { ...t, type: { toString: () => t.type } };
    case 18: return { ...t, size: 'text' };
    case 19: return { ...t, size: 1.5 };
    case 20: return [t.type, t.size];
    case 21: return Object.assign(() => 0, { type: t.type, size: t.size });
    case 22: return 'text';
    default: { const o = { ...t }; Object.setPrototypeOf(o, { size: 100 }); return o; }
  }
}
function run(list: T[]): number[] {
  const out: number[] = [];
  for (const t of list) { let r = 1; if (t.type === 'add') r += t.f0 * 1; if (t.type === 'remove') r += t.f1 * 2; if (t.type === 'move') r += t.f2 * 3; if (t.type === 'rename') r += t.f3 * 4; if (t.type === 'open') r += t.f4 * 5; out.push(r); }
  return out;
}
function byIndex(list: T[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) { const t = list[i]!; let r = 1; if (t.type === 'add') r += t.f0 * 1; if (t.type === 'remove') r += t.f1 * 2; if (t.type === 'move') r += t.f2 * 3; if (t.type === 'rename') r += t.f3 * 4; if (t.type === 'open') r += t.f4 * 5; sum = (sum * 31 + (typeof r === 'number' && r === r ? r | 0 : 3)) % 1000003; }
  return sum;
}
function one(t: T): number { let r = 1; if (t.type === 'add') r += t.f0 * 1; if (t.type === 'remove') r += t.f1 * 2; if (t.type === 'move') r += t.f2 * 3; if (t.type === 'rename') r += t.f3 * 4; if (t.type === 'open') r += t.f4 * 5; return r; }
const list: T[] = [];
for (let i = 0; i < 240; i++) {
  if (i % 5 === 0) list.push({ type: 'add', f0: i, size: i }); else if (i % 5 === 1) list.push({ type: 'remove', f1: i, size: i }); else if (i % 5 === 2) list.push({ type: 'move', f2: i, size: i }); else if (i % 5 === 3) list.push({ type: 'rename', f3: i, size: i }); else if (i % 5 === 4) list.push({ type: 'open', f4: i, size: i });
}
(globalThis as unknown as { kept: unknown }).kept = list;
let h = 0; const say = (l: T[]) => { const a = run(l); const b = byIndex(l); const c = l.map(one); h = (h * 31 + b) % 1000003; return a.join(' ') + ' | ' + b + ' | ' + c.join(' '); };
for (let round = 0; round < 3; round++) console.log(say(list.slice(0, 40)));
for (let i = 0; i < 24; i++) { const l = list.slice(0, 12); for (let j = 0; j < 12; j += 3) l[j] = any(other(list[j + i], i)); try { console.log(i, say(l)); } catch (e) { console.log(i, (e as Error).name); } }
console.log(h);
export {};
