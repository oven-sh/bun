// An object that is defined by all the descriptors of a function has the name of the function, and a literal holds what a read of it answers.
function f() {}
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(f));
console.log({ name: r.name });
