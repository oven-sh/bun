const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log("first.mjs:", above === Object.prototype ? "Object.prototype" : "another object");
