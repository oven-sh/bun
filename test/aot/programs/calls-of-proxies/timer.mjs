// A call of a Proxy answers as in plain Bun: timer.
const real = setTimeout; const guarded = new Proxy(real, { apply(t, r, l) { if (l[1] > 10) l[1] = 1; return Reflect.apply(t, r, l); } }); await new Promise(done => guarded(done, 100000)); console.log("fired");
