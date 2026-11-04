Object.freeze(Object.prototype);
const E = {};
for (E.toString of [0, 1]);
for (E.valueOf in { a: 1 });
console.log(typeof E.toString, typeof E.valueOf, Object.keys(E).length);
