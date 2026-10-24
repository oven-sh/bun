var arguments;
var exports, module;
console.log(arguments.length, arguments[0] === exports, arguments[2] === module);
arguments[0] = "stored through the object";
console.log(exports);
module = "stored to the variable";
console.log(arguments[2]);
