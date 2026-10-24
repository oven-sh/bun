// What `new Shape()` makes has the layout of Shape. What is made for another new.target has not, whoever asks for it: the program by name, or code that nobody has seen through a proxy.
function Shape() { this.a = 1; this.b = 2; }
Shape.prototype.sum = function () { return this.a + this.b; };
function Other() { this.c = 3; }
Other.prototype.sum = function () { return "other " + this.a + " " + this.c; };
class Base { constructor() { this.base = 1; } }
class Derived extends Base { constructor() { super(); this.derived = 2; } }
function plain() {}
function make(callee) { return new callee(); }
function read(shape) { return shape.a + shape.b; }

const handedShape = new Proxy(Shape, {});
const handedOther = new Proxy(Other, {});
const handedDerived = new Proxy(Derived, {});
const handedPlain = new Proxy(plain, {});

console.log(read(new Shape()), new Shape().sum(), read(make(handedShape)), make(handedShape) instanceof Shape);
console.log(make(handedOther).c, make(handedDerived).derived, make(handedDerived).base, typeof make(handedPlain));

const foreign = Reflect.construct(Shape, [], Other);
console.log(read(foreign), foreign.sum(), foreign instanceof Other, foreign instanceof Shape, foreign.c);
const throughProxies = Reflect.construct(handedShape, [], handedOther);
console.log(read(throughProxies), throughProxies.sum(), throughProxies instanceof Other);
const forDerived = Reflect.construct(Shape, [], Derived);
console.log(read(forDerived), forDerived instanceof Derived, forDerived.derived, forDerived.base);
const ofBase = Reflect.construct(Base, [], Shape);
console.log(ofBase.base, ofBase.a, ofBase instanceof Shape, ofBase.sum());
console.log(read(new Shape()), new Other().c, new Derived().derived);
