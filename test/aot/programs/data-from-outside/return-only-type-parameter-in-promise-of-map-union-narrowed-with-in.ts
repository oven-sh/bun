// A generic function returns a promise of Map<string, R> and none of its parameters mention R, so R is only what the caller claims. The type argument is a union that the caller narrows with `in`. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function all<R>(text: string): Promise<Map<string, R>> { return Promise.resolve(new Map<string, R>([['x', JSON.parse(text) as R]])) }
async function ask() { const answer = (await all<{ k: Part } | { e: string }>('{"k": {"id": 1}}')).get('x')!; return 'k' in answer ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
