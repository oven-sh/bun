// `super` in an arrow function in a static field initializer goes by the class.
class A { static f = () => typeof super.call; }
console.log(A.f());
