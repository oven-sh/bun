// Eight ways to write `receiver.method(operand())`, ordinary and in tail position, under try and in a generator; the operand changes the receiver; strangers arrive for the receiver.
type Op = () => number; const log: string[] = []; const mine = () => "mine"; const three = ["push", "substring", "set"];
const all = (v: unknown) => ({ push: v, substring: v, set: v });
console.log("SAID known", [Array.prototype.push, String.prototype.substring, Map.prototype.set].map(f => f.name).join());
const doors: Record<string, (r: any, o: Op) => unknown> = {
  tailAdds(r: number[], o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return r.push(o()); },
  adds(r: number[], o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return "<" + r.push(o()) + ">" + w; },
  triedAdds(r: number[], o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; try { return r.push(o()); } finally { log.push("finally"); } },
  yieldedAdds(r: number[], o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return (function* () { return r.push(o()); })().next().value; },
  tailCuts(r: string, o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return r.substring(o(), 4); },
  cuts(r: string, o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return "<" + r.substring(o(), 4) + ">" + w; },
  tailSets(r: Map<number, number>, o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return r.set(1, o()); },
  sets(r: Map<number, number>, o: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return (r.set(1, o()) === r) + ":" + r.get(1) + w; },
};
const kinds: Record<string, () => any> = { list: () => [1, 2], table: () => new Map([[1, 1]]), text: () => "alphabet", boxed: () => new String("alphabet") };
const changes: Record<string, (r: any) => void> = {
  none() {}, lays(r) { r.push = r.substring = r.set = mine; }, proto(r) { Object.setPrototypeOf(r, all(mine)); }, freezes(r) { Object.freeze(r); },
  getter(r) { for (const n of three) Object.defineProperty(r, n, { configurable: true, get() { log.push("late"); return mine; } }); },
  empties(r) { if (Array.isArray(r)) r.length = 0; else if (r instanceof Map) r.clear(); }, throws() { throw new RangeError("operand"); },
};
const hostile: Record<string, () => any> = {
  nothing: () => null, number: () => all(5), bound: () => all(Math.max.bind(null, 7)), klass: () => all(class K {}),
  getter: () => { const g = { get() { log.push("read"); return (...a: unknown[]) => { log.push("call"); return a.length; }; } }; return Object.defineProperties({}, all(g) as PropertyDescriptorMap); },
  proxy: () => new Proxy([1], { get(t, k, s) { log.push("trap:" + String(k)); return Reflect.get(t, k, s); } }),
  heir: () => new (class extends Array<number> { push() { return -1; } })(),
};
const names: string[] = JSON.parse('["tailAdds","adds","triedAdds","yieldedAdds","tailCuts","cuts","tailSets","sets"]');
function say(title: string, make: () => any, change: (r: any) => void) {
  for (const name of names) { log.length = 0; const said: string[] = []; const r = make();
    for (let turn = 0; turn < 2; turn++) { try { said.push(String(doors[name](r, () => { log.push("operand"); change(r); return 3; }))); } catch (e) { said.push((e as Error).name); } }
    console.log("SAID", title, name, said.join("|"), log.join(">")); }
}
for (const k in kinds) for (const c in changes) say(k + "." + c, kinds[k], changes[c]);
for (const h in hostile) say(h, hostile[h], () => {});
export {};
