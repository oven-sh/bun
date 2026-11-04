const o = { a: 1, b: 2 };

function act(given) { Object.defineProperty(o, Object.keys({ a: 0 })[0], { get() { return "text"; } }); }
console.log(typeof o.a, typeof o.b);
act("a");
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
