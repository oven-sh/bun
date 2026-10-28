// A call of a Proxy answers as in plain Bun: new-target.
const p = new Proxy(function () { return new.target === undefined; }, {}); console.log(p());
