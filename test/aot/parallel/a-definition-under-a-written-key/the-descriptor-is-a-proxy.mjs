const o = { a: 1, b: 2 };
function makeDescriptor() { return { get() { this.b = "text"; return "text"; } }; }
function act() { Object.defineProperty(o, "a", new Proxy({}, { get(t, k) { if (k === "value") { o.b = "text"; return "text"; } return undefined; }, has(t, k) { return k === "value"; } })); }
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b);
console.log(typeof o.a, typeof o.b);
