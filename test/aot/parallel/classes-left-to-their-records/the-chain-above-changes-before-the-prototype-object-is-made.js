class Top { top() { return "top"; } }
class Above { who() { return "above"; } }
class Below extends Above { own() { return this.who() + (this.top ? this.top() : "-"); } }
class Sealed extends Above { own() { return "sealed"; } }
class Given extends Above { own() { return "given"; } }
Object.setPrototypeOf(Above.prototype, Top.prototype);
Above.prototype.late = function () { return "late"; };
console.log(new Below().own(), new Below().late(), Object.getPrototypeOf(Below.prototype) === Above.prototype, new Below() instanceof Top);
Object.freeze(Sealed.prototype);
console.log(Object.isFrozen(Sealed.prototype), (() => { "use strict"; try { Sealed.prototype.x = 1; return "stored"; } catch (e) { return e.constructor.name; } })(), new Sealed().own(), new Sealed().who());
Object.defineProperty(Given.prototype, "own", { value() { return "replaced"; }, configurable: true });
Given.prototype.extra = 5;
console.log(new Given().own(), new Given().extra, Object.keys(Given.prototype).join(), Object.getOwnPropertyNames(Given.prototype).join());
if (typeof Bun !== "undefined") Bun.gc(true);
class Late extends Above { own() { return "late class"; } }
if (typeof Bun !== "undefined") Bun.gc(true);
console.log(new Late().own(), new Late().top(), Object.getPrototypeOf(Late.prototype) === Above.prototype);
