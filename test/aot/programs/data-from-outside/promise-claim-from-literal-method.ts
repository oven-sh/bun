// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. A method of an object literal annotated Promise<T> returns the promise. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const held = new Map<string, { k: Part }>()
const api = { load(): Promise<{ k: Part }> { return later('{"k": {"id": 1}}') } }
async function ask() { const answer = await api.load(); held.set('x', answer); return held.get('x')!.k }
console.log(JSON.stringify(await ask()))
