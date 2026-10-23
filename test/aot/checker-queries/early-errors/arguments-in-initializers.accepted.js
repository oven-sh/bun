// arguments inside a function or a method, which has its own, arguments in the computed name or a decorator of a field, and arguments as a property name.
class C { a = function () { arguments; }; }
function f() { class C { [arguments[0]] = 1; } }
class C { m() { arguments; } }
class C { static { function f() { arguments; } } }
class C { a = { m() { arguments; } }; }
class C { a = { arguments: 1 }; }
class C { a = this.arguments; }
function f(log) { class C { @log(arguments[0]) a = 1; } }
// Not listed: class C { a = function (b = arguments) {}; } ECMAScript allows it and JavaScriptCore's parser rejects it.
