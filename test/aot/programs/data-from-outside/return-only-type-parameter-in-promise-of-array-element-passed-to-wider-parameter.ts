// A generic function returns a promise of R[] and none of its parameters mention R, so R is only what the caller claims. An element is passed to a parameter whose type has one more optional member. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function use(given: { k: Part; j?: number }): Part { return given.k }
function all<R>(text: string): Promise<R[]> { return Promise.resolve(JSON.parse(text) as R[]) }
async function ask() { const answer = (await all<{ k: Part }>('[' + '{"k": {"id": 1}}' + ']'))[0]!; return use(answer) }
console.log(JSON.stringify(await ask()))
