// An untyped package and a program of it (diffs): clone, merge, equality, differences, paths, freezing and mapping over anything
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let state = { users: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], meta: { page: 1, tags: ['x'] }, on: true }; const start = lib.freeze(lib.clone(state));
for (let i = 0; i < 16; i++) { const next = lib.clone(state); [() => next.users.push({ id: 3 + i, name: 'n' + i }), () => { next.meta.page += 0.5; }, () => { delete next.meta.tags; }, () => lib.set(next, 'meta.tags[2].deep', i), () => { next.users[i % next.users.length].name = i; }, () => { next.users.length = 1; }, () => { next['new' + i] = [i, { i }]; }, () => { next.on = NaN; }][i % 8](); const ops = lib.diff(state, next), back = lib.apply(state, ops); say(i, JSON.stringify(ops), lib.equal(back, next), lib.get(next, 'users[0].name', 'none'), lib.get(next, 'meta.tags.2.deep', '-')); state = next; }
say(JSON.stringify(lib.diff(start, state)).length, Object.isFrozen(start.users[0]), JSON.stringify(start));
