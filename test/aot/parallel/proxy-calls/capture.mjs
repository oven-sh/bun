// A call of a Proxy answers as in plain Bun: capture.
const p = new Proxy(function inner() { const o = {}; Error.captureStackTrace(o, inner); return o.stack.split("\n").length; }, {}); console.log(p());
