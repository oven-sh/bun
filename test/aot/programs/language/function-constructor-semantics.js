// What --aot fixes of a function that is compiled (the prototype of a generator function, caller, arguments) it does not fix of one that is made of text at run time. One row differs from plain Bun: constant text is compiled with the program, so `caller` and `arguments` of the two functions made of it are null.
const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
const made = [
  ["GeneratorFunction()", GeneratorFunction()],
  ["GeneratorFunction with a body", GeneratorFunction("a", "yield a")],
  ["AsyncGeneratorFunction()", AsyncGeneratorFunction()],
  ["a class that extends GeneratorFunction", new (class extends GeneratorFunction {})()],
  ["a generator function out of Function()", Function("return function* named() {}")()],
  ["a generator function out of an indirect eval", (0, eval)("(function* evaluated() {})")],
];
for (const [name, f] of made) {
  const { writable } = Object.getOwnPropertyDescriptor(f, "prototype");
  let holds;
  try { f.prototype = "another"; holds = f.prototype === "another"; } catch (e) { holds = e.name; }
  console.log(name + ": writable " + writable + ", a store holds: " + holds + ", Reflect.set: " + Reflect.set(f, "prototype", 5) + " " + f.prototype);
}
const asks = Function("return function asks() { return [typeof asks.caller, asks.caller === null, typeof asks.arguments, asks.arguments && asks.arguments.length]; }")();
const calls = Function("asks", "return function calls() { return asks(1, 2, 3); }")(asks);
console.log("caller and arguments, both made of text:", String(calls()));
console.log("not running:", asks.caller, asks.arguments);
