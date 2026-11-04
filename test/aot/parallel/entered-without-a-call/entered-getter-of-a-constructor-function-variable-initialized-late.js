// Getter of a constructor function enters code that has an effect (variable initialized late), and a caller of the function that holds it looks at the state before and behind.
let late;
function init() { late = { v: 1 }; }
function F() { this.own = 1; }
Object.defineProperty(F.prototype, "x", { get() { if (!late) init(); late.v++; return 1; }, configurable: true });
function make() { return new F(); }
function middle(c, k) { return c.x; }
function outer(c) { const before = (late ? late.v : "none"); middle(c, "x"); const behind = (late ? late.v : "none"); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += (late ? late.v : "none") + ","; } return s; }
console.log(outer(make()), looped(make()));
