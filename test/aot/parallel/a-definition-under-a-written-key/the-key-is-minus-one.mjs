const o = { a: 1, b: 2 };
function act() { Object.defineProperty(o, "-1", { get() { this.b = "text"; return 7; }, enumerable: true }); }
act();
function at(h, i) { return h[i]; }
console.log(typeof o.b, o[-1], typeof o.b, Object.keys(o).join());
