// A call of a Proxy answers as in plain Bun: caught-in-trap.
const p = new Proxy(function () { throw new Error("deep"); }, { apply(t, r, l) { try { return Reflect.apply(t, r, l); } catch (e) { return "caught " + e.message; } } }); console.log(p());
