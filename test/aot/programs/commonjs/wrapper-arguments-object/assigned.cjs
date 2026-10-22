const object = arguments;
console.log(arguments === object, object.length);
var arguments = ["replaced"];
console.log(arguments.length, arguments[0], object.length);
object[0] = "still mapped";
console.log(exports);
