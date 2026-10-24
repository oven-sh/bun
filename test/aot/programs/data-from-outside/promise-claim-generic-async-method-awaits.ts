// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. An async method of `class Client<R>` awaits later<R>(text) and returns the value. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
class Client<R> { async get(text: string): Promise<R> { const value = await later<R>(text); return value } }
async function ask() { const answer = await new Client<{ ok: true; k: Part } | { ok: false; e: string }>().get('{"ok": true, "k": {"id": 1}}'); return answer.ok ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
