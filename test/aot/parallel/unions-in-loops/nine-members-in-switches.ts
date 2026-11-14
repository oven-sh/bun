// A union of nine members whose fields lie apart, over lists with holes, null and numbers.
declare const process: { argv: string[] }; declare const structuredClone: any;
type T = { type: 'add'; f0: number; size: number } | { g1_0: number; type: 'remove'; f1: number; size: number } | { g2_0: number; g2_1: number; type: 'move'; f2: number; size: number } | { g3_0: number; g3_1: number; g3_2: number; type: 'rename'; f3: number; size: number } | { type: 'open'; f4: number; size: number } | { g5_0: number; type: 'close'; f5: number; size: number } | { g6_0: number; g6_1: number; type: 'insert'; f6: number; size: number } | { g7_0: number; g7_1: number; g7_2: number; type: 'update'; f7: number; size: number } | { type: 'replace'; f8: number; size: number };

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
  for (const t of list) { let r = 1; switch (t.type) { case 'add': r += t.f0 * 1; break; case 'remove': r += t.f1 * 2; break; case 'move': r += t.f2 * 3; break; case 'rename': r += t.f3 * 4; break; case 'open': r += t.f4 * 5; break; case 'close': r += t.f5 * 6; break; case 'insert': r += t.f6 * 7; break; case 'update': r += t.f7 * 8; break; case 'replace': r += t.f8 * 9; break; default: r += 5; } out.push(r); }
  return out;
}
function byIndex(list: T[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) { const t = list[i]!; let r = 1; switch (t.type) { case 'add': r += t.f0 * 1; break; case 'remove': r += t.f1 * 2; break; case 'move': r += t.f2 * 3; break; case 'rename': r += t.f3 * 4; break; case 'open': r += t.f4 * 5; break; case 'close': r += t.f5 * 6; break; case 'insert': r += t.f6 * 7; break; case 'update': r += t.f7 * 8; break; case 'replace': r += t.f8 * 9; break; default: r += 5; } sum = (sum * 31 + (typeof r === 'number' && r === r ? r | 0 : 3)) % 1000003; }
  return sum;
}
function one(t: T): number { let r = 1; switch (t.type) { case 'add': r += t.f0 * 1; break; case 'remove': r += t.f1 * 2; break; case 'move': r += t.f2 * 3; break; case 'rename': r += t.f3 * 4; break; case 'open': r += t.f4 * 5; break; case 'close': r += t.f5 * 6; break; case 'insert': r += t.f6 * 7; break; case 'update': r += t.f7 * 8; break; case 'replace': r += t.f8 * 9; break; default: r += 5; } return r; }
const list: T[] = [];
for (let i = 0; i < 240; i++) {
  if (i % 9 === 0) list.push({ type: 'add', f0: i, size: i }); else if (i % 9 === 1) list.push({ g1_0: i, type: 'remove', f1: i, size: i }); else if (i % 9 === 2) list.push({ g2_0: i, g2_1: i, type: 'move', f2: i, size: i }); else if (i % 9 === 3) list.push({ g3_0: i, g3_1: i, g3_2: i, type: 'rename', f3: i, size: i }); else if (i % 9 === 4) list.push({ type: 'open', f4: i, size: i }); else if (i % 9 === 5) list.push({ g5_0: i, type: 'close', f5: i, size: i }); else if (i % 9 === 6) list.push({ g6_0: i, g6_1: i, type: 'insert', f6: i, size: i }); else if (i % 9 === 7) list.push({ g7_0: i, g7_1: i, g7_2: i, type: 'update', f7: i, size: i }); else if (i % 9 === 8) list.push({ type: 'replace', f8: i, size: i });
}
(globalThis as unknown as { kept: unknown }).kept = list;
let h = 0; const say = (l: T[]) => { const a = run(l); const b = byIndex(l); const c = l.map(one); h = (h * 31 + b) % 1000003; return a.join(' ') + ' | ' + b + ' | ' + c.join(' '); };
for (let round = 0; round < 3; round++) console.log(say(list.slice(0, 40)));
const holes: T[] = list.slice(0, 9); delete (holes as any)[4]; holes.length = 12; for (const l of [holes, [null as never, list[0]!], [undefined as never], [list[1]!, 3 as never, list[2]!]]) { try { console.log(say(l)); } catch (e) { console.log((e as Error).name); } }
console.log(h);
export {};
