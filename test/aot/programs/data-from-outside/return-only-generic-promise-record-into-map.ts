// A generic function returns a promise of Record<string, R> and none of its parameters mention R, so R is only what the caller claims. A value is stored in a typed Map. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const held = new Map<string, { k: Part }>()
function all<R>(text: string): Promise<Record<string, R>> { return Promise.resolve(JSON.parse(text) as Record<string, R>) }
async function ask() { const answer = (await all<{ k: Part }>('{"x": ' + '{"k": {"id": 1}}' + '}'))['x']!; held.set('x', answer); return held.get('x')!.k }
console.log(JSON.stringify(await ask()))
