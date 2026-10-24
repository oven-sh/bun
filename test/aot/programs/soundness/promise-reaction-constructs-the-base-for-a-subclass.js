let leaked;
class A { constructor(p) { leaked = this; this.x = p; this.r = this.m(); } m() { return "A.m"; } }
class B extends A { s = 5; m() { return "B.m"; } }
function report(label) { console.log(label, leaked.r, leaked instanceof B, leaked.s, Object.keys(leaked).join(), Object.getPrototypeOf(leaked) === B.prototype, leaked.m()); }
Promise.resolve(B).then(Reflect.construct.bind(null, A, [1])).then(o => { console.log(o === leaked, o.r, o.s); report("reaction"); });
