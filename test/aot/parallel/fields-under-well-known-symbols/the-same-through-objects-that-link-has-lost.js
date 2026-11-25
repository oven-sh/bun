const tag = Symbol("tag");
let alias = tag;
class Other { constructor(v) { this.v = v; } }
class Base { [alias] = JSON.parse('"own"'); }
class H1 extends Base {}
class H2 extends Base {}
class H3 extends Base {}
class H4 extends Base { get [tag]() { return "getter"; } }
let seen = 0;
function see(o) { seen += o instanceof Other ? 10 : 1; return o; }
for (const o of [new Other(1), new Base(), new H1(), new H2(), new H3(), new H4()]) see(o);
const h = new H4();
console.log(h[tag], seen);
