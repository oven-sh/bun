// A call of a Proxy answers as in plain Bun: caught-outside.
function outer(f) { let kept = [1, 2, 3], n = 5.5, s = "text"; try { f(1); } catch (e) { return [e.message, kept.join(), n, s].join("|"); } } console.log(outer(new Proxy(function () { throw new Error("deep"); }, { apply(t, r, l) { return Reflect.apply(t, r, l); } })), outer(new Proxy(function () { throw new Error("deep"); }, {})));
