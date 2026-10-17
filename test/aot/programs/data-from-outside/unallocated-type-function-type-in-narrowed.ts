// No object of the record type is ever created: parsed data that matches it arrives from an arrow function that is typed by a generic function type. The type is a union of two record types that are never created, narrowed with `in`. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
type Loader<R> = (text: string) => Promise<R>
async function ask() { const load: Loader<{ k: Part } | { e: string }> = text => Promise.resolve(JSON.parse(text)); const answer = await load('{"k": {"id": 1}}'); return 'k' in answer ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
