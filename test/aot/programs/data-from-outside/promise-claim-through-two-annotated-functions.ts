// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. Two functions that are not async and are annotated Promise<T> hand the promise on. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function inner(): Promise<{ ok: true; k: Part } | { ok: false; e: string }> { return later('{"ok": true, "k": {"id": 1}}') }
function outer(): Promise<{ ok: true; k: Part } | { ok: false; e: string }> { return inner() }
async function ask() { const answer = await outer(); return answer.ok ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
