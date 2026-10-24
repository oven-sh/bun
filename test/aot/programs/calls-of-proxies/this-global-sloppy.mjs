// A call of a Proxy answers as in plain Bun: this-global-sloppy.
const p = new Proxy(Function("return this === globalThis"), { apply(t, r, l) { console.log(r === undefined); return Reflect.apply(t, r, l); } }); console.log(p());
