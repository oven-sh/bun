// Object.assign runs the getter of its source, which writes a field of the target that the copy has already stored and one that it has yet to store.
const target = { first: 0, value: 0, last: 0 };
const source = { first: 1, get value() { target.first = 10; target.last = 30; return 2; }, last: 3 };
function copy(into, from) { into.first = -1; Object.assign(into, from); return into.first * 10000 + into.value * 100 + into.last; }
console.log(copy(target, source), target.first, target.value, target.last);
