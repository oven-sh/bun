// A call of a Proxy answers as in plain Bun: global-replaced.
const real = globalThis.setTimeout; globalThis.setTimeout = new Proxy(real, { apply(t, r, l) { console.log("asked for", l[1]); return Reflect.apply(t, r, l); } }); await new Promise(done => setTimeout(done, 1)); console.log("fired");
