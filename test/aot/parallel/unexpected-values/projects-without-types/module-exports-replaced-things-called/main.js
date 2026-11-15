var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function invoke(callee, value) {
  return callee(value);
}
function invokeByCall(callee, value) {
  return callee.call(null, value);
}
function invokeByApply(callee, value) {
  return callee.apply(null, [value]);
}
function invokeBound(callee, value) {
  return callee.bind(null)(value);
}
function construct(callee, value) {
  return new callee(value);
}
function reflect(callee, value) {
  return Reflect.apply(callee, undefined, [value]);
}
function mapped(callee, value) {
  return [value].map(callee);
}
function members(callee) {
  return [typeof callee, callee.length, callee.name, typeof callee.prototype, callee.extra];
}
var uses = { invoke: invoke, invokeByCall: invokeByCall, invokeByApply: invokeByApply, invokeBound: invokeBound, construct: construct, reflect: reflect, mapped: mapped, members: members };

var plain = require("./callables/plain");
var sum = 0;
for (var i = 0; i < 2000; i++) sum += invoke(plain, i) + invokeByCall(plain, i) + invokeByApply(plain, i) + invokeBound(plain, i) + reflect(plain, i) + mapped(plain, i)[0] + members(plain).length;
console.log("sum", sum);

attempt("seen a class", function () {
  return require("./callables/a-class")(1);
});
attempt("seen an object", function () {
  return require("./callables/an-object-with-call-and-apply")(1);
});
attempt("seen a number", function () {
  return require("./callables/a-number")(1);
});

var names = ["plain", "a-class", "bound", "proxied", "an-object-with-call-and-apply", "an-arrow", "a-generator", "a-method", "replaced-twice", "a-number", "nothing"];
names.forEach(function (name) {
  var callee = require("./callables/" + name);
  Object.keys(uses).forEach(function (use) {
    attempt(use + "(" + name + ")", function () {
      return uses[use](callee, 1);
    });
  });
});
console.log("traps", require("./callables/proxied").log.join(", "));
attempt("plain again", function () {
  return [invoke(plain, 1), invokeByCall(plain, 1), invokeByApply(plain, 1), construct(plain, 1)];
});
