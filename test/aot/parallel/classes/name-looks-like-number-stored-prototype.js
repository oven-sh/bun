// "-2", "1.5" and "1e3" look like numbers and are no index: they are names. A store under one to the prototype object of a class adds a property.
class Base {
}

class A extends Base {
}
const box = Object.freeze({ held: A.prototype });
try {
  box.held["-2"] = 4;
} catch (e) {}
console.log("ended");
