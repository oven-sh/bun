const o = { a: 1, b: 2 };
const names = ["b", "a"];
function act(given) { Object.defineProperty(o, names[1], { get() { return "text"; } }); }
console.log(typeof o.a, typeof o.b);
act("a");
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
