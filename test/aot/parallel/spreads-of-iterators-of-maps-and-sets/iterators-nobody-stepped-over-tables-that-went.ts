const collect = () => (globalThis as any).Bun.gc(true), said: string[] = [];
function ends(list: unknown[]): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return list.length + ":" + String(list[1]) + ":" + String(list[list.length - 1]); }
const m = new Map<number, number>(), s = new Set<number>(); for (let i = 0; i < JSON.parse("64"); i++) { m.set(i, -i); s.add(i); }
const a: any = m.values(), b: any = m.keys(), c: any = s.values(), d: any = m.values(), e: any = s.keys(), onEmpty: any = new Map<number, number>().keys();
for (let i = 0; i < 60; i++) { m.delete(i); s.delete(i); } collect(); said.push(ends([0, ...a]), ends([0, ...c]));
for (let i = 100; i < 400; i++) { m.set(i, -i); s.add(i); } collect(); said.push(ends([0, ...b]));
m.clear(); s.clear(); m.set(7, -7); s.add(7); collect();
said.push(ends([0, ...d]), ends([0, ...e]), ends([0, ...onEmpty]), [a, b, c, d, e, onEmpty].map(it => it.next().done).join());
console.log(`SAID ${said.join(" ")}`); export {};
