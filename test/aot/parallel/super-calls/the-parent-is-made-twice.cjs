function make(k) { return class Parent { constructor(a) { this.k = k; this.a = a; } }; }
function below(parent) { return class Below extends parent { constructor(a) { super(a); this.b = 2; } }; }
const first = below(make(1)), second = below(make(2));
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new (i & 1 ? first : second)(i); out.push(o.k + ":" + o.a + ":" + (o instanceof first)); } return out.join(" "); }
console.log(run(4));
