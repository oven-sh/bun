// A call of a Proxy answers as in plain Bun: stack-depth.
const p = new Proxy(function () { return new Error("x").stack.split("\n").length; }, { apply(t, r, l) { return Reflect.apply(t, r, l); } }); const q = new Proxy(function () { return new Error("x").stack.split("\n").length; }, {}); function a() { return [p(), q()].join(); } console.log(a());
