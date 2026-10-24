// A call of a Proxy answers as in plain Bun: finally-outside.
function outer(f) { const seen = []; try { try { f(); } finally { seen.push("finally"); } } catch (e) { seen.push(e.message); } return seen.join(); } console.log(outer(new Proxy(function () { throw new Error("deep"); }, { apply(t, r, l) { try { return Reflect.apply(t, r, l); } finally { } } })));
