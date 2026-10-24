// A binding visible to a direct `eval` may not be the class; a binding outside the eval's scope is.
function f() { class K {} }
class C {}
eval("C");
