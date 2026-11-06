var attempt = require("./show").attempt;
var a = require("./a");
var b = require("./b");
var c = require("./c");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

attempt("what b saw while a was half filled", function () { return a.whatBSaw; });
attempt("what b sees now", b.now);
attempt("what b copied", b.copies);
for (var i = 0; i < 2000; i++) b.now();
attempt("what b sees after 2000 looks", b.now);
a.late = "late";
a.count = 2n;
a.double = "not a function";
attempt("what b sees after stores from outside", b.now);
Object.keys(c.d).forEach(function (name) {
  attempt("d." + name, c.d[name]);
});
attempt("typeof c", function () { return typeof c; });
