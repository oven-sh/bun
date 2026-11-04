// Getter defined on an instance enters code that has an effect (field of another object), and a caller of the function that holds it looks at the state before and behind.
const holder = { n: 0 };
class C { own = 1; }
function make() { return Object.defineProperty(new C(), "x", { get() { holder.n++; return 1; }, configurable: true }); }
function middle(c, k) { return c.x; }
function outer(c) { const before = holder.n; middle(c, "x"); const behind = holder.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += holder.n + ","; } return s; }
console.log(outer(make()), looped(make()));
