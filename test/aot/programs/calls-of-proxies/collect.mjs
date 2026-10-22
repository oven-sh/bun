// A call of a Proxy answers as in plain Bun: collect.
const p = new Proxy(function (a) { return a.length; }, { apply(t, r, l) { const waste = []; for (let i = 0; i < 2000; i++) waste.push({ i }); return Reflect.apply(t, r, l) + waste.length; } }); let s = 0; for (let i = 0; i < 3000; i++) s += p("abc" + i); Bun.gc(true); console.log(s);
