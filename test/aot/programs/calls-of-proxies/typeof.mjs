// A call of a Proxy answers as in plain Bun: typeof.
const p = new Proxy(function () {}, {}); console.log(typeof p, p instanceof Function, Object.prototype.toString.call(p), p.name, p.length);
