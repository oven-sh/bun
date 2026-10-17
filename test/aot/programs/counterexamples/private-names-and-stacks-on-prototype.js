// A private field or a captured stack put on the prototype object of a class stays there when the prototype is looked into.
class Base { constructor(o) { return o; } }
class Stamp extends Base { #p = 1; static has(o) { return #p in o; } }
class C { m() {} }
new Stamp(C.prototype);
console.log(Stamp.has(C.prototype), typeof C.prototype.m, Stamp.has(C.prototype));
class D { m() {} }
Error.captureStackTrace(D.prototype);
console.log(typeof D.prototype.stack);
