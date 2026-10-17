// A class reached as the prototype of its subclass can be constructed.
class B { b = 1; }
class H extends B {}
console.log(new (Object.getPrototypeOf(H))().b);
