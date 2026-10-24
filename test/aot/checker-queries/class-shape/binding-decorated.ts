// A class decorator can replace the binding, so it may not be the class.
class K {}
function d(c: any) { return c; }
@d
class C {}
