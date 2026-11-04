const o = { a: 1, b: 2 };
let k = "b"; if (Date.now() > 0) k = "a";
function act(given) { Object.defineProperty(o, k, { get() { return "text"; } }); }
console.log(typeof o.a, typeof o.b);
act("a");
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
