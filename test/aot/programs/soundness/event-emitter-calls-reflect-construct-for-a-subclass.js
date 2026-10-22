let leaked;
class A { constructor(p) { leaked = this; this.x = p; this.r = this.m(); } m() { return "A.m"; } }
class B extends A { s = 5; m() { return "B.m"; } }
function report(label) { console.log(label, leaked.r, leaked instanceof B, leaked.s, Object.keys(leaked).join(), Object.getPrototypeOf(leaked) === B.prototype, leaked.m()); }
const { EventEmitter } = require("node:events");
const e = new EventEmitter(); e.on("make", Reflect.construct); e.emit("make", A, [1], B);
report("emit");
