// Getter defined on an instance enters code that has an effect (type of a field), and a caller of the function that holds it looks at the state before and behind.
const holder = { v: 1 };
class C { own = 1; }
function make() { return Object.defineProperty(new C(), "x", { get() { holder.v = typeof holder.v === "number" ? "text" : 1; return 1; }, configurable: true }); }
function middle(c, k) { return c.x; }
function outer(c) { const before = typeof holder.v; middle(c, "x"); const behind = typeof holder.v; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += typeof holder.v + ","; } return s; }
console.log(outer(make()), looped(make()));
