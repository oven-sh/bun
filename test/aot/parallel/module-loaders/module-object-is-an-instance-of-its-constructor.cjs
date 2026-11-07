// Every module object is an instance of the class that node:module exports. Nothing in the program names node:module.
console.log(module instanceof module.constructor, Object.getPrototypeOf(module) === module.constructor.prototype);
