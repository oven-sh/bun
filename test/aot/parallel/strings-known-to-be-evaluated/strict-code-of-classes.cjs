// The code of a class is strict, and the key of a method of an object is code of what is around it.
function value(a = eval("(function () { return typeof this; })")()) { return a; }
class Fields { own = eval("(function () { return typeof this; })")(); arrow = () => eval("(function () { return typeof this; })")(); static shared = eval("(function () { return typeof this; })")(); static { this.block = eval("(function () { return typeof this; })")(); } method(a = eval("(function () { return typeof this; })")()) { return a + eval("(function (a) { arguments[0] = 2; return a; })")(1); } }
console.log(value(), new Fields().own, new Fields().arrow(), Fields.shared, Fields.block, new Fields().method());
const keys = { [eval("(function () { return typeof this; })")()]() { "use strict"; }, get [eval("(function () { return typeof this + 2; })")()]() { "use strict"; return 1; }, async *[eval("(function () { return typeof this + 3; })")()](a) { "use strict"; } };
console.log(Object.keys(keys).join());
class Inside { method() { return Object.keys({ [eval("(function () { return typeof this; })")()]() {} })[0]; } }
console.log(new Inside().method());
