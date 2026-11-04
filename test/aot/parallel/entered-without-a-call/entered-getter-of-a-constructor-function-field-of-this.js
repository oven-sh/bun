// Getter of a constructor function enters code that has an effect (field of this), and a caller of the function that holds it looks at the state before and behind.
function F() { this.own = 1; }
Object.defineProperty(F.prototype, "x", { get() { this.n = (this.n || 0) + 1; return 1; }, configurable: true });
function make() { return new F(); }
function middle(c, k) { return c.x; }
function outer(c) { const before = c.n; middle(c, "x"); const behind = c.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += c.n + ","; } return s; }
console.log(outer(make()), looped(make()));
