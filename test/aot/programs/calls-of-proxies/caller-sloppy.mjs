// A call of a Proxy answers as in plain Bun: caller-sloppy.
const p = new Proxy(function inner() { return typeof inner.caller; }, {}); try { console.log(Function("p", "return p()")(p)); } catch (e) { console.log(e.name); }
