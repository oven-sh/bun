// delete of any other operand.
var a = {}; delete a.b;
var a = {}; delete a[0];
delete 1;
class C { #a; m() { delete this.#a.b; } }
var a = {}; delete (a.b);
function f() {} delete f();
