function describe() {
  "use strict";
  return [typeof this, this.length, arguments.length, this[0], arguments[1]].join();
}
function isFirstArgument() {
  "use strict";
  return this === arguments[0];
}
function Made() {
  this.count = arguments.length;
  this.first = arguments[0];
}

function reflected() {
  return Reflect.apply(Math.max, arguments, arguments);
}
function applied() {
  return describe.apply(arguments, arguments);
}
function appliedByReflect() {
  return Reflect.apply(describe, arguments, arguments);
}
function named(a, b) {
  return describe.apply(arguments, arguments);
}
function namedStrict(a, b) {
  "use strict";
  return describe.apply(arguments, arguments);
}
function changed(a, b) {
  a = 9;
  return describe.apply(arguments, arguments);
}
function holdsItself() {
  arguments[0] = arguments;
  return isFirstArgument.apply(arguments, arguments);
}
function spread() {
  return describe.call(arguments, ...arguments);
}
function literal() {
  const values = [4, 5, 6];
  return Math.max.apply(values, values);
}
function literalToFunction() {
  const values = [4, 5, 6];
  return describe.apply(values, values);
}
function rest(...values) {
  return describe.apply(values, values);
}
function constructed() {
  return JSON.stringify(Reflect.construct(Made, arguments, Made));
}
function calledItself() {
  try {
    return Function.prototype.apply.call(arguments, arguments, arguments);
  } catch (error) {
    return error.constructor.name;
  }
}

for (let turn = 0; turn < 3; turn++) {
  console.log(reflected(3, 7, 5), reflected());
  console.log(applied(1, 2), appliedByReflect("a", "b", "c"), applied());
  console.log(named(1, 2), named(1), named(1, 2, 3), namedStrict(1, 2), namedStrict(), changed(1, 2), changed());
  console.log(holdsItself(1), spread(1, 2), literal(), literalToFunction(), rest(7, 8), rest());
  console.log(constructed(1, 2), calledItself(1));
}
