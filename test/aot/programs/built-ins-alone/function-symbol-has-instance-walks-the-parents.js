class Base {}
class Child extends Base {}
console.log(Function.prototype[Symbol.hasInstance].call(Base, new Child()), Function.prototype[Symbol.hasInstance].call(Child, new Base()));
