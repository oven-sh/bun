// Getter defined on a prototype enters code that has an effect (closure of each entry), and a caller of the function that holds it looks at the state before and behind.
const made = [];
class C { own = 1; }
Object.defineProperty(C.prototype, "x", { get() { { let n = 0; made.push(() => ++n); } return 1; }, configurable: true });
function make() { return new C(); }
function middle(c, k) { return c.x; }
function outer(c) { const before = made.map(f => f()).join(""); middle(c, "x"); const behind = made.map(f => f()).join(""); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += made.map(f => f()).join("") + ","; } return s; }
console.log(outer(make()), looped(make()));
