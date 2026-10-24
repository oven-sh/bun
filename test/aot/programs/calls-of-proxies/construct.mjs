// A call of a Proxy answers as in plain Bun: construct.
const p = new Proxy(function F(a) { this.a = a; }, { apply() { return "called"; } }); console.log(p(1), new p(2).a);
