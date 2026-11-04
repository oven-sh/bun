const E = { a: 1 };
Object.preventExtensions(E);
E.b = 2; E.a = 3;
console.log(E.a, E.b, Object.keys(E).join());
