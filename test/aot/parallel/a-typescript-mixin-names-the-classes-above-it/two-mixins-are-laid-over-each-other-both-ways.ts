type Made<T = object> = new (...args: any[]) => T;
class Ground { g = 1; sum(): number { return this.g; } }
function red<B extends Made<Ground>>(Base: B) { return class Red extends Base { r = 10; sum(): number { return super.sum() + this.r; } }; }
function blue<B extends Made<Ground>>(Base: B) { return class Blue extends Base { b = 100; sum(): number { return super.sum() * 2 + this.b; } }; }
class RedOnBlue extends red(blue(Ground)) { own = 1000; sum(): number { return super.sum() + this.own; } }
class BlueOnRed extends blue(red(Ground)) { own = 2000; sum(): number { return super.sum() + this.own; } }
class Thrice extends red(blue(red(Ground))) {}
for (const made of [new RedOnBlue(), new BlueOnRed(), new Thrice()]) console.log(made.sum(), Object.keys(made).join(), made.r, made.b);
