// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. An async method of `class Client<R>` returns `JSON.parse(text) as R`. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function use(given: { k: Part; j?: number }): Part { return given.k }
class Client<R> { async get(text: string): Promise<R> { return JSON.parse(text) as R } }
async function ask() { const answer = await new Client<{ k: Part }>().get('{"k": {"id": 1}}'); return use(answer) }
console.log(JSON.stringify(await ask()))
