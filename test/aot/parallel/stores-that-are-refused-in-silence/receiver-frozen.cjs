const E = { a: 1 };
Object.freeze(E);
E.a = 2; E.b = 3;
console.log(E.a, E.b, Object.keys(E).join());
