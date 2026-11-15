// answers: with-library
// # `if (map.has(key)) .. map.get(key)` in a loop: the table is searched once: `has` finds the place of the key, `get` reads there. The place stands only while nothing has been written into the storage of collections: a delete, a clear, a store under the key, a key that is added, a table that grows and a call of what nobody knows between the two end it; so does another map. Keys of every kind. Each function makes its map in sight: of a map that is handed in, each call asks anew whether it is as made, and what the other arm may have run ends the place: there the table is searched twice, as before; a class below Map with a get of its own, a map with an own get and an object that is no map answer as plain.
// # f2 = plain, f3 = both, f4 = deleted
// # RUN(FORM): walk f2 f3 f4 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: [[place]]: {{*}} = FindKeyInMap
// # FORM: = GetValueAtPlaceInMap {{*}}, [[place]]
// # FORM-LABEL: code f3:Body
// # FORM: [[second]]: {{*}} = FindKeyInMap
// # FORM: = GetValueAtPlaceInMap {{*}}, [[second]]
// # FORM-LABEL: code f4:Body
// # FORM-NOT: GetValueAtPlaceInMap
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 32 of 32 of 32
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
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
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
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
