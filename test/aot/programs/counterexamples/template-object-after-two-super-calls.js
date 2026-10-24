// A tagged template in a field initializer has one template object though the constructor has two `super()` calls.
const id = s => s;
class D extends Object { t = id`x`; constructor(c) { if (c) super(); else super(); } }
console.log(new D(1).t === new D(0).t, new D(1).t === new D(1).t);
