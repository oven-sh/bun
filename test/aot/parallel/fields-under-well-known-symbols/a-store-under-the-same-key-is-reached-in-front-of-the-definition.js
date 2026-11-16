const tag = Symbol("tag");
let alias = tag;
class Base { [alias] = JSON.parse('"own"'); }
class H1 extends Base {}
class H2 extends Base {}
class H3 extends Base {}
class H4 extends Base { get [tag]() { return "getter"; } }
function early(o) { o[tag] = 1; return o; }
early(new H1()); early(new H2());
function made(n) { return n === 0 ? new Base() : n === 1 ? new H1() : n === 2 ? new H2() : new H3(); }
for (let n = 0; n < 4; ++n) console.log(made(n)[tag]);
const h = new H4();
console.log(h[tag], Object.hasOwn(h, tag));
// twin: the name is listed
class Base2 { size = JSON.parse('"own"'); }
class K1 extends Base2 {}
class K2 extends Base2 {}
class K3 extends Base2 {}
class K4 extends Base2 { get size() { return "getter"; } }
console.log([new Base2(), new K1(), new K2(), new K3()].length, new K4().size);
