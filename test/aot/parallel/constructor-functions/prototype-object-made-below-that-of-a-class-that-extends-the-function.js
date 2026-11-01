// A class extends a constructor function, and the function then gets a prototype object that is made below the prototype object of the class. Then that object gets a new property.
function F() {}
class X extends (() => F)() {}
F.prototype = Object.create(X.prototype);
const made = new F();
console.log(made instanceof X, made instanceof F, made.late);
F.prototype.late = 4;
console.log(made instanceof X, made.late, Object.getPrototypeOf(X.prototype) === F.prototype);
