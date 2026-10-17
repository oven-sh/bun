// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. The promise goes through Promise.any, and the result is passed through a function typed with an alias of the same shape. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
type Answer = { k: Part }
function same(given: Answer): Answer { return given }
async function ask() { const answer = await Promise.any([later<{ k: Part }>('{"k": {"id": 1}}')]); return same(answer).k }
console.log(JSON.stringify(await ask()))
