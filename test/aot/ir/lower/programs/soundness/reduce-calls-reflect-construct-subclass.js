// RUN: lower
// OPTIONS: builtin-modules

// Reduce calls reflect construct for a subclass.
let leaked;
class A { constructor(p) { leaked = this; this.x = p; this.r = this.m(); } m() { return "A.m"; } }
class B extends A { s = 5; m() { return "B.m"; } }
function report(label) { console.log(label, leaked.r, leaked instanceof B, leaked.s, Object.keys(leaked).join(), Object.getPrototypeOf(leaked) === B.prototype, leaked.m()); }
const o = [[1], B].reduce(Reflect.construct.bind(null, A));
console.log(o === leaked, o.r, o.s); report("reduce");

// CHECK-LABEL: function {{*}}name="report"
// CHECK-LABEL: function {{*}}name="A"
// CHECK-LABEL: function {{*}}name="B"
