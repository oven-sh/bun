Object.freeze(Object.prototype);
const E = {};
({ a: E.toString, b: E.size } = { a: 0, b: 1 });
[E.valueOf] = [2];
console.log(typeof E.toString, E.size, typeof E.valueOf, Object.keys(E).join());
