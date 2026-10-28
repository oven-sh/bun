// A constructor stores `self` on an instance that inherits from the global object. The store runs the setter of globalThis.self, so the instance gets no property of its own.
function Below() {
  this.self = "stored by a constructor";
}
Below.prototype = Object.create(globalThis);
const made = new Below();
console.log(Object.hasOwn(made, "self"), self, made.self);
