// No object of the record type is ever created: parsed data that matches it arrives from a promise that is kept in a class field. It is stored in a typed Map. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const held = new Map<string, { k: Part }>()
class Pending { pending = later<{ k: Part }>('{"k": {"id": 1}}') }
async function ask() { const answer = await new Pending().pending; held.set('x', answer); return held.get('x')!.k }
console.log(JSON.stringify(await ask()))
