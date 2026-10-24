// A generic function returns a new empty R[] and none of its parameters mention R. The caller fills it with parsed data and reads an element. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function empty<R>(): R[] { return [] }
async function ask() { const list = empty<{ k: Part }>(); list.push(JSON.parse('{"k": {"id": 1}}')); const answer = list[0]!; return answer.k }
console.log(JSON.stringify(await ask()))
