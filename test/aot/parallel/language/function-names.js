// The `name` of every kind of function the program writes, of a bound function, of a name the program defines itself, of a built-in and of a function made from text at run time. language/obfuscated-function-names runs this file built with --obfuscate.
function declared() {}
const arrow = () => {};
const expression = function inner() {};
class Shape { method() {} static make() {} }
class Named { static name = "kept"; }
const object = { method() {}, property: function () {} };
async function later() {}
function* each() {}
const renamed = () => {};
Object.defineProperty(renamed, "name", { value: "given" });
const show = (label, value) => console.log(label + ":", JSON.stringify(value));

show("a declaration", declared.name);
show("an arrow function in a constant", arrow.name);
show("a named function expression", expression.name);
show("a class", Shape.name);
show("a method", Shape.prototype.method.name);
show("a static method", Shape.make.name);
show("a method of a literal", object.method.name);
show("a function in a property", object.property.name);
show("an async function", later.name);
show("a generator function", each.name);
show("a bound function", declared.bind(null).name);
show("the constructor of an instance", new Shape().constructor.name);
show("a class with a static field called name", Named.name);
show("a name the program defines", renamed.name);
show("a built-in", Math.max.name);
show("a function made from text at run time", new Function("return " + process.argv.length).name);
