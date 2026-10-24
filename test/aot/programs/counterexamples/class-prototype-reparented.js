// The prototype object of a class, reached through an instance, is given another parent.
class C {}
Object.setPrototypeOf(Object.getPrototypeOf(new C()), {});
console.log(C.name);
