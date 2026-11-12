// Records of one shape go through a list born here by shift, pop, at, an index and find; the same names come out of a parse; both kinds lie in one list; a record gains a name, is frozen, or is no record at all.
function drain(queue, take) { let sum = 0, turns = 0; while (queue.length && turns++ < 50) { const { node, steps } = take(queue); sum += node * 3 + steps; } return sum; }
const own = () => [{ node: 1, steps: 2 }, { node: 3, steps: 4 }, { node: 5, steps: 6 }];
const parsed = () => JSON.parse('[{"node":1,"steps":2},{"steps":4,"node":3},{"node":5,"steps":6,"more":7}]');
const said = [];
for (let round = 0; round < 3; round++) {
  for (const make of [own, parsed, () => [...own(), ...parsed()]]) {
    said.push(drain(make(), q => q.shift()), drain(make(), q => q.pop()), drain(make(), q => { const at = q.at(-1); q.length--; return at; }), drain(make(), q => { const at = q[0]; q.splice(0, 1); return at; }), drain(make(), q => { const at = q.find(r => r.node > 0); q.splice(q.indexOf(at), 1); return at; }));
  }
  const odd = own(); odd[0].more = 1; Object.freeze(odd[1]); odd.push({ steps: 1 }, "text", 7);
  said.push(String(drain(odd, q => q.shift())));
  try { drain([null], q => q.shift()); } catch (e) { said.push(e.constructor.name); }
}
console.log(said.join(" "));
