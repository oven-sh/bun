const o = { a: 1, b: 2 };
const k = Date.now() > 0 ? "a" : "b";
function act(given) { Object.defineProperty(o, k, { get() { return "text"; } }); }
console.log(typeof o.a, typeof o.b);
act("a");
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
