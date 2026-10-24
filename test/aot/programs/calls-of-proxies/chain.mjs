// A call of a Proxy answers as in plain Bun: chain.
let f = function (a) { return a + 1; }; for (let i = 0; i < 20; i++) f = new Proxy(f, i & 1 ? {} : { apply(t, r, l) { return Reflect.apply(t, r, l) + 1; } }); console.log(f(0));
