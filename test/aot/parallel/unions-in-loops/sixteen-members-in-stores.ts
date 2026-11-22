// A union of sixteen members whose objects change their kinds, gain fields and lose fields.
declare const process: { argv: string[] }; declare const structuredClone: any;
type T = { type: 'add'; f0: string; size: number } | { type: 'remove'; size: number } | { type: 'move'; f2: string; size: number } | { type: 'rename'; size: number } | { type: 'open'; f4: string; size: number } | { type: 'close'; size: number } | { type: 'insert'; f6: string; size: number } | { type: 'update'; size: number } | { type: 'replace'; f8: string; size: number } | { type: 'text'; size: number } | { type: 'comment'; f10: string; size: number } | { type: 'element'; size: number } | { type: 'length'; f12: string; size: number } | { type: 'x'; size: number } | { type: 'constructor'; f14: string; size: number } | { type: 'name'; size: number };

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
  for (const t of list) { let r = 1; if (t.type === 'add') { t.size = t.size + 1; r += t.size; } if (t.type === 'remove') { t.size = t.size + 2; r += t.size; } if (t.type === 'move') { t.size = t.size + 3; r += t.size; } if (t.type === 'rename') { t.size = t.size + 4; r += t.size; } if (t.type === 'open') { t.size = t.size + 5; r += t.size; } if (t.type === 'close') { t.size = t.size + 6; r += t.size; } if (t.type === 'insert') { t.size = t.size + 7; r += t.size; } if (t.type === 'update') { t.size = t.size + 8; r += t.size; } if (t.type === 'replace') { t.size = t.size + 9; r += t.size; } if (t.type === 'text') { t.size = t.size + 10; r += t.size; } if (t.type === 'comment') { t.size = t.size + 11; r += t.size; } if (t.type === 'element') { t.size = t.size + 12; r += t.size; } if (t.type === 'length') { t.size = t.size + 13; r += t.size; } if (t.type === 'x') { t.size = t.size + 14; r += t.size; } if (t.type === 'constructor') { t.size = t.size + 15; r += t.size; } if (t.type === 'name') { t.size = t.size + 16; r += t.size; } out.push(r); }
  return out;
}
function byIndex(list: T[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) { const t = list[i]!; let r = 1; if (t.type === 'add') { t.size = t.size + 1; r += t.size; } if (t.type === 'remove') { t.size = t.size + 2; r += t.size; } if (t.type === 'move') { t.size = t.size + 3; r += t.size; } if (t.type === 'rename') { t.size = t.size + 4; r += t.size; } if (t.type === 'open') { t.size = t.size + 5; r += t.size; } if (t.type === 'close') { t.size = t.size + 6; r += t.size; } if (t.type === 'insert') { t.size = t.size + 7; r += t.size; } if (t.type === 'update') { t.size = t.size + 8; r += t.size; } if (t.type === 'replace') { t.size = t.size + 9; r += t.size; } if (t.type === 'text') { t.size = t.size + 10; r += t.size; } if (t.type === 'comment') { t.size = t.size + 11; r += t.size; } if (t.type === 'element') { t.size = t.size + 12; r += t.size; } if (t.type === 'length') { t.size = t.size + 13; r += t.size; } if (t.type === 'x') { t.size = t.size + 14; r += t.size; } if (t.type === 'constructor') { t.size = t.size + 15; r += t.size; } if (t.type === 'name') { t.size = t.size + 16; r += t.size; } sum = (sum * 31 + (typeof r === 'number' && r === r ? r | 0 : 3)) % 1000003; }
  return sum;
}
function one(t: T): number { let r = 1; if (t.type === 'add') { t.size = t.size + 1; r += t.size; } if (t.type === 'remove') { t.size = t.size + 2; r += t.size; } if (t.type === 'move') { t.size = t.size + 3; r += t.size; } if (t.type === 'rename') { t.size = t.size + 4; r += t.size; } if (t.type === 'open') { t.size = t.size + 5; r += t.size; } if (t.type === 'close') { t.size = t.size + 6; r += t.size; } if (t.type === 'insert') { t.size = t.size + 7; r += t.size; } if (t.type === 'update') { t.size = t.size + 8; r += t.size; } if (t.type === 'replace') { t.size = t.size + 9; r += t.size; } if (t.type === 'text') { t.size = t.size + 10; r += t.size; } if (t.type === 'comment') { t.size = t.size + 11; r += t.size; } if (t.type === 'element') { t.size = t.size + 12; r += t.size; } if (t.type === 'length') { t.size = t.size + 13; r += t.size; } if (t.type === 'x') { t.size = t.size + 14; r += t.size; } if (t.type === 'constructor') { t.size = t.size + 15; r += t.size; } if (t.type === 'name') { t.size = t.size + 16; r += t.size; } return r; }
const list: T[] = [];
for (let i = 0; i < 240; i++) {
  if (i % 16 === 0) list.push({ type: 'add', f0: 'q' + i, size: i }); else if (i % 16 === 1) list.push({ type: 'remove', size: i }); else if (i % 16 === 2) list.push({ type: 'move', f2: 'q' + i, size: i }); else if (i % 16 === 3) list.push({ type: 'rename', size: i }); else if (i % 16 === 4) list.push({ type: 'open', f4: 'q' + i, size: i }); else if (i % 16 === 5) list.push({ type: 'close', size: i }); else if (i % 16 === 6) list.push({ type: 'insert', f6: 'q' + i, size: i }); else if (i % 16 === 7) list.push({ type: 'update', size: i }); else if (i % 16 === 8) list.push({ type: 'replace', f8: 'q' + i, size: i }); else if (i % 16 === 9) list.push({ type: 'text', size: i }); else if (i % 16 === 10) list.push({ type: 'comment', f10: 'q' + i, size: i }); else if (i % 16 === 11) list.push({ type: 'element', size: i }); else if (i % 16 === 12) list.push({ type: 'length', f12: 'q' + i, size: i }); else if (i % 16 === 13) list.push({ type: 'x', size: i }); else if (i % 16 === 14) list.push({ type: 'constructor', f14: 'q' + i, size: i }); else if (i % 16 === 15) list.push({ type: 'name', size: i });
}
(globalThis as unknown as { kept: unknown }).kept = list;
let h = 0; const say = (l: T[]) => { const a = run(l); const b = byIndex(l); const c = l.map(one); h = (h * 31 + b) % 1000003; return a.join(' ') + ' | ' + b + ' | ' + c.join(' '); };
for (let round = 0; round < 3; round++) console.log(say(list.slice(0, 40)));
for (const t of list.slice(0, 20) as any[]) { t.type = t.type === 'add' ? 'remove' : 'add'; t.f0 ??= 4; }
console.log(say(list.slice(0, 30)));
for (const t of list.slice(5, 25) as any[]) { t.later = 1; delete t.size; }
console.log(say(list.slice(0, 30)));
console.log(h);
export {};
