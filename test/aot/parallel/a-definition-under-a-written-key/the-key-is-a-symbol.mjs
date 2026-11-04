const s = Symbol("s");
const o = { a: 1, [s]: 1 };
function act() { Object.defineProperty(o, s, { get() { this.a = "text"; return "text"; } }); }
act();
console.log(typeof o.a, typeof o[s], typeof o.a);
