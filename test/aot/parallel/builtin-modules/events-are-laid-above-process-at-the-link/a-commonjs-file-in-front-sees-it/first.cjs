const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log("first.cjs:", above === Object.prototype ? "Object.prototype" : "another object");
