// No object of the record type is ever created: parsed data that matches it arrives from a method that the caller only knows by its interface. It is pushed to a typed array. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const all_of_them: { k: Part }[] = []
interface Api { load(): Promise<{ k: Part }> }
const api: Api = { load() { return later('{"k": {"id": 1}}') } }
async function ask() { const answer = await api.load(); all_of_them.push(answer); return all_of_them[0]!.k }
console.log(JSON.stringify(await ask()))
