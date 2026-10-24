// A call of a Proxy answers as in plain Bun: primitive-this.
const p = new Proxy(function () { "use strict"; return typeof this; }, { apply(t, r, l) { return typeof r + " " + Reflect.apply(t, r, l); } }); console.log(p.call(5), p.call("s"), p.call(null), p.call(true), p.call(Symbol.iterator), p.call(5n));
