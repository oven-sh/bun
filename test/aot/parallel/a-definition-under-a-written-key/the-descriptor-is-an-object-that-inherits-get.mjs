const o = { a: 1, b: 2 };
function makeDescriptor() { return { get() { this.b = "text"; return "text"; } }; }
function act() { Object.defineProperty(o, "a", Object.create({ get() { this.b = "text"; return "text"; } })); }
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b);
console.log(typeof o.a, typeof o.b);
