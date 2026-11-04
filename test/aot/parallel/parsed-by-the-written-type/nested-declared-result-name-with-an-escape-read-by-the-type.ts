type T = { user: { id: number; name: string; }; on: boolean; };
function load(text: string): T { return JSON.parse(text); }
function tell(f: () => unknown) { try { console.log(String(f())); } catch (error) { console.log((error as Error).name + ": " + (error as Error).message); } }
const texts = ['{"user":{"id":1,"name":"n"},"on":true}', '{"\\u0075ser":{"id":1,"name":"n"},"on":true}'];
for (const text of [texts[0], texts[1], texts[1]]) {
  tell(() => { const v = load(text); return [(v === null || typeof v !== "object" ? "-" : (v.user && v.user.id)), (v === null || typeof v !== "object" ? "-" : (v.user && v.user.name)), (v === null || typeof v !== "object" ? "-" : (v.on)), (v === null || typeof v !== "object" ? "-" : typeof (v.user && v.user.id)), (v === null || typeof v !== "object" ? "-" : typeof (v.user && v.user.name)), (v === null || typeof v !== "object" ? "-" : typeof (v.on))].map(String).join(" | "); });
}
