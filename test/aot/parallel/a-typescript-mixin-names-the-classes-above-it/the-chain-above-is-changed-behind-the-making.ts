type Made<T = object> = new (...args: any[]) => T;
class Low { l = 1; say(): string { return "low" + this.l; } }
class Else { say(): string { return "else"; } }
function raised<B extends Made<Low>>(Base: B) { return class Raised extends Base { r = 2; say(): string { return super.say() + ">raised" + this.r; } }; }
class Top extends raised(Low) { t = 3; say(): string { return super.say() + ">top" + this.t; } }
const top = new Top();
console.log(top.say());
Low.prototype.say = function () { return "patched" + this.l; };
console.log(top.say());
Object.setPrototypeOf(Object.getPrototypeOf(Top.prototype), Else.prototype);
console.log(top.say(), top instanceof Low, top instanceof Else);
Object.setPrototypeOf(Top.prototype, Low.prototype);
console.log(top.say(), new Top().say(), Object.keys(new Top()).join());
Object.setPrototypeOf(Top, Else);
console.log(Object.keys(new Top()).join(), new Top().say());
