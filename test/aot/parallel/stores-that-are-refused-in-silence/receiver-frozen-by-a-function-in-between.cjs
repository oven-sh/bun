function close(o) { Object.freeze(o); }
const E = { a: 1 };
E.a = 2;
close(E);
E.a = 3; E.b = 4;
console.log(E.a, E.b);
