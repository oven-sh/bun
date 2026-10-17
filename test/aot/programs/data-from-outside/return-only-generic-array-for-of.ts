// A generic function returns `JSON.parse(text) as R[]` and none of its parameters mention R, so R is only what the caller claims. Each element of a for-of loop is pushed to a typed array. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const all_of_them: { k: Part }[] = []
function list<R>(text: string): R[] { return JSON.parse(text) as R[] }
async function ask() { for (const answer of list<{ k: Part }>('[' + '{"k": {"id": 1}}' + ']')) { all_of_them.push(answer); return all_of_them[0]!.k }; return 'none' }
console.log(JSON.stringify(await ask()))
