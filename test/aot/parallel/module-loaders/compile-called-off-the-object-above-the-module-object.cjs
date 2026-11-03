// The _compile on Object.getPrototypeOf(module) compiles a text for a module that the program made.
const made = new module.constructor("/virtual/made.js");
made.filename = "/virtual/made.js";
Object.getPrototypeOf(module)._compile.call(made, "module.exports = 7;", "/virtual/made.js");
console.log(made.exports);
