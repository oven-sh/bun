// A call of a Proxy answers as in plain Bun: revoked-in-trap.
let r; const made = Proxy.revocable(function (a) { return a; }, { apply(t, s, l) { r(); return Reflect.apply(t, s, l); } }); r = made.revoke; console.log(made.proxy(4)); try { made.proxy(5); } catch (e) { console.log(e.name, e.message); }
