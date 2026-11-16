// An untyped package and a program of it (curried): memoize with resolvers, limits and weak keys; once, curry, compose, partial, after, before, pipeline with placeholders
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var _ = lib._, add3 = lib.curry(function (a, b, c) { return [this && this.tag, a, b, c].join('-'); }), forms = [function () { return add3(1)(2)(3); }, function () { return add3(1, 2)(3); }, function () { return add3(_, 2)(1)(3); }, function () { return add3(_, _, 3)(_, 2)(1); }, function () { return add3(1, 2, 3, 4); }, function () { return add3.call({ tag: 't' }, 1, 2, 3); }, function () { return typeof add3(_, _, _); }, function () { return lib.curry(function () { return arguments.length; }, 2)(5)(6, 7); }, function () { return add3()()(1)()(2, 3); }];
for (var n = 0; n < 2; n++) forms.forEach(function (f, i) { say(n, i, f()); }); var c = lib.compose(function (x) { return x + '!'; }, function (x) { return x * 2; }, function (a, b) { return a + b; }); for (var i = 0; i < 6; i++) say(i, c(i, i % 2 ? 'x' : 0.5), lib.compose(String)(i));
