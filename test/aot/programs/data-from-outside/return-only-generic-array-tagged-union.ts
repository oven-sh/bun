// A generic function returns `JSON.parse(text) as R[]` and none of its parameters mention R, so R is only what the caller claims. The type argument is a tagged union and an element is narrowed by its tag. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function list<R>(text: string): R[] { return JSON.parse(text) as R[] }
async function ask() { const answer = list<{ ok: true; k: Part } | { ok: false; e: string }>('[' + '{"ok": true, "k": {"id": 1}}' + ']')[0]!; return answer.ok ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
