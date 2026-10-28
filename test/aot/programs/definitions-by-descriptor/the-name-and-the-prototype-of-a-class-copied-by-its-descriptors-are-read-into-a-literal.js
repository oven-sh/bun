// An object that is defined by all the descriptors of a class has its name and its prototype object, and a literal holds what reads of them answer.
class K {}
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(K));
const o = { p: r.prototype === K.prototype, n: r.name };
console.log(o.p, o.n);
