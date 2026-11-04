const E = { a: 1 };
Object.defineProperty(E, "a", { writable: false });
E.a = 2;
console.log(E.a);
