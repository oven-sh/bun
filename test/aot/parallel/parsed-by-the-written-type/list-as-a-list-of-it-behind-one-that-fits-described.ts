type E = { id: number; name: string; };
type T = E[];
function load(text: string) { return JSON.parse(text) as T; }
function tell(f: () => unknown) { try { console.log(String(f())); } catch (error) { console.log((error as Error).name + ": " + (error as Error).message); } }
const texts = ['[{"id":1,"name":"n"}]', '[{"id":1,"name":"n"},[{"id":1,"name":"n"}]]'];
for (const text of [texts[0], texts[1], texts[1]]) {
  tell(() => { const v = load(text); return [(JSON.stringify(v)), (v === null || typeof v !== "object" ? "-" : Object.keys(v).join()), (v === null || typeof v !== "object" ? "-" : Reflect.ownKeys(v).map(String).join()), (v === null || typeof v !== "object" ? "-" : Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === Array.prototype), (v === null || typeof v !== "object" ? "-" : JSON.stringify(Object.getOwnPropertyDescriptors(v))), (v === null || typeof v !== "object" ? "-" : (() => { const names = []; for (const name in v) names.push(name); return names.join(); })()), (v === null || typeof v !== "object" ? "-" : JSON.stringify({ ...v })), (Object.prototype.toString.call(v))].map(String).join(" | "); });
}
