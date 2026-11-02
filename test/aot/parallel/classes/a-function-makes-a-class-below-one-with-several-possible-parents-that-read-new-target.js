// The topmost constructor reads new.target, which Reflect.construct() chooses too.
class P { constructor() { this.t = new.target.name; } k() { return 1; } }
class Q { constructor() { this.t = new.target.name; } k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class Made extends c {};
const Made = derive(B);
console.log(new Made().t, new Made().k(), Reflect.construct(B, [], Made).t, Reflect.construct(Made, [], B).t, new B().t);
