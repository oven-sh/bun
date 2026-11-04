const o = { a: 1, b: 2 };
const part = Date.now() > 0 ? "" : "x";
function act(given) { Object.defineProperty(o, "a" + part, { get() { return "text"; } }); }
console.log(typeof o.a, typeof o.b);
act("a");
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
