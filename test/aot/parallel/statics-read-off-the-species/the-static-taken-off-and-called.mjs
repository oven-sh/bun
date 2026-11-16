const M = Array[Symbol.species];
const { from } = M;
console.log(from.call(M, "abcd").length, from.call(Object, { length: 1, 0: 1 }).length);
