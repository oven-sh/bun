// `if (o === undefined) { o = {..}; p = 5; }` is more than a default of o: the store to p happens too.
function f(o, p) { if (o === undefined) { o = { a: 1 }; p = 5; } return o.a + p; }
console.log(f({ a: 1 }, 0), f(undefined, 0));
