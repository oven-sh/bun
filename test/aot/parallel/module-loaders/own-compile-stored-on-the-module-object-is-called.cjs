// A _compile stored on the module object is an own property, and a call finds it.
module._compile = function (text) {
  return "own:" + text;
};
console.log(module._compile("a", "b"), Object.hasOwn(module, "_compile"));
