const told: string[] = []; function report(value: unknown) { told.push(String(value)); }
const keys: unknown[] = [1, 2.5, -0, 0, NaN, "a", "b" + String(1), "", undefined, null, true, 10n, Symbol.iterator, { }, [], 1e21, -1, 4294967296, 0.1 + 0.2];
function filled(): Map<unknown, unknown> { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); return map; }
function plain() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) said += map.get(key) + ";"; else said += "-;"; } return said; }
function both() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; const is = map.has(key); said += is + ":" + map.get(key) + ";"; } return said; }
function deleted() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.delete(key); said += map.get(key) + ";"; } } return said + map.size; }
function cleared() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.clear(); said += map.get(key) + ";"; } } return said + map.size; }
function stored() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.set(key, i); said += map.get(key) + ";"; } } return said; }
function added() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (!map.has(key)) { map.set(key, "new " + i); said += map.get(key) + ";"; } } return said + map.size; }
function grown() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { for (let more = 0; more < 40; more++) map.set("more " + i + " " + more, more); said += map.get(key) + ";"; } } return said + map.size; }
function between(act: (map: Map<unknown, unknown>, key: unknown) => void) { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { act(map, key); said += map.get(key) + ";"; } } return said + map.size; }
function other() { const map = new Map<unknown, unknown>(); for (let i = 0; i < keys.length; i += 2) map.set(keys[i], "at " + i); const second = new Map<unknown, unknown>(); second.set(1, "second"); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) said += second.get(key) + ";"; } return said; }
function handed(map: Map<unknown, unknown>) { let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) said += map.get(key) + ";"; else said += "-;"; } return said; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ": " + (e as Error).message); } }
const acts = [(map: Map<unknown, unknown>, key: unknown) => { map.delete(key); }, (map: Map<unknown, unknown>) => { map.clear(); }, (map: Map<unknown, unknown>, key: unknown) => { map.set(key, "again"); }, (map: Map<unknown, unknown>, key: unknown) => { map.delete(key); map.set(key, "back"); }, () => { }];
for (let turn = 0; turn < 2; turn++) { tell(() => plain()); tell(() => both()); tell(() => deleted()); tell(() => cleared()); tell(() => stored()); tell(() => added()); tell(() => grown()); for (let a = 0; a < acts.length; a++) tell(() => between(acts[a]!)); tell(() => other()); }
class Below extends Map<unknown, unknown> { get(key: unknown) { return "below " + String(super.get(key)); } }
const below = new Below(); below.set(1, "one");
tell(() => handed(below));
const own = filled(); (own as any).get = () => "own";
tell(() => handed(own));
tell(() => handed({ has: () => true, get: (key: unknown) => typeof key } as never));
tell(() => handed(filled()));
tell(() => handed(new Map()));
report("end");
console.log(told.join("\n"));
