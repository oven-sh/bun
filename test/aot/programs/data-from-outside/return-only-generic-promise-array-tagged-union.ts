// A generic function returns a promise of R[] and none of its parameters mention R, so R is only what the caller claims. A method writes a tagged union as the type argument and narrows an element by its tag. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function all<R>(text: string): Promise<R[]> { return Promise.resolve(JSON.parse(text) as R[]) }
class Caller { async ask() { const answer = (await all<{ ok: true; k: Part } | { ok: false; e: string }>('[' + '{"ok": true, "k": {"id": 1}}' + ']'))[0]!; return answer.ok ? answer.k : answer.e } }
console.log(JSON.stringify(await new Caller().ask()))
