const above = Object.getPrototypeOf(module);
console.log(typeof above.require, Object.getPrototypeOf(above) === Object.prototype);
