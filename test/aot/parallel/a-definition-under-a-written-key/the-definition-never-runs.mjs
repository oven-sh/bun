const o = { a: 1, b: () => 2 };
function act() { if (Date.now() < 0) Object.defineProperty(o, "hiddenName", { get() { return 1; } }); }
act();
console.log(typeof o.a, o.b(), Object.keys(o).join());
