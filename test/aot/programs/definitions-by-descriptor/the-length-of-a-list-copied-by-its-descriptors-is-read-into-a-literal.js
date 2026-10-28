// An object that is defined by all the descriptors of a list has the length of the list, and a literal holds what a read of it answers.
const f = [1, 2];
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(f));
const o = { n: r.length };
console.log(o.n);
