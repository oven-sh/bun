// Private getter enters code that has an effect (object of each entry), and a caller of the function that holds it looks at the state before and behind.
const made = [];
class C { get #x() { { const o = { n: made.length }; made.push(o); } return 1; } read() { return this.#x; } }
function make() { return new C(); }
function middle(c, k) { return c.read(); }
function outer(c) { const before = made.map(o => o.n).join("") + (made.length > 1 && made[0] === made[1]); middle(c, "x"); const behind = made.map(o => o.n).join("") + (made.length > 1 && made[0] === made[1]); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += made.map(o => o.n).join("") + (made.length > 1 && made[0] === made[1]) + ","; } return s; }
console.log(outer(make()), looped(make()));
