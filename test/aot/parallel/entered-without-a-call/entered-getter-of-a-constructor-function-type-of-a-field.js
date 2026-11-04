// Getter of a constructor function enters code that has an effect (type of a field), and a caller of the function that holds it looks at the state before and behind.
const holder = { v: 1 };
function F() { this.own = 1; }
Object.defineProperty(F.prototype, "x", { get() { holder.v = typeof holder.v === "number" ? "text" : 1; return 1; }, configurable: true });
function make() { return new F(); }
function middle(c, k) { return c.x; }
function outer(c) { const before = typeof holder.v; middle(c, "x"); const behind = typeof holder.v; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += typeof holder.v + ","; } return s; }
console.log(outer(make()), looped(make()));
