// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. A generator function yields `JSON.parse(text) as R`, and none of its parameters mention R. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function* each<R>(texts: string[]): Generator<R> { for (const text of texts) yield JSON.parse(text) as R }
async function ask() { for (const answer of each<{ k: Part }>(['{"k": {"id": 1}}'])) { const copy = { ...answer, j: 1 }; return copy.k }; return 'none' }
console.log(JSON.stringify(await ask()))
