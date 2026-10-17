const which = "return this === undefined ? 'strict' : 'sloppy'";
exports.rows = {
  "outside a class"() {
    const f = function () { return this === undefined ? "strict" : "sloppy"; };
    return f();
  },
  "in a field initializer"() {
    class A { f = function () { return this === undefined ? "strict" : "sloppy"; }; }
    const f = new A().f;
    return f();
  },
  "in a static field initializer"() {
    class A { static f = function () { return this === undefined ? "strict" : "sloppy"; }; }
    const f = A.f;
    return f();
  },
  "in a computed key"() {
    let f;
    class A { [(f = function () { return this === undefined ? "strict" : "sloppy"; }, "m")]() {} }
    return f();
  },
  "in the heritage"() {
    let f;
    class A extends (f = function () { return this === undefined ? "strict" : "sloppy"; }, Object) {}
    return f();
  },
  "in a method"() {
    class A { m() { return (function () { return this === undefined ? "strict" : "sloppy"; })(); } }
    return new A().m();
  },
  "in a static block"() {
    let f;
    class A { static { f = function () { return this === undefined ? "strict" : "sloppy"; }; } }
    return f();
  },
  "declared in a function in a field initializer"() {
    class A { f = function () { function inner() { return this === undefined ? "strict" : "sloppy"; } return inner(); }; }
    return new A().f();
  },
  "in an object literal in the heritage of a class expression"() {
    const held = {};
    const A = class extends (Object.assign(held, { f: function () { return this === undefined ? "strict" : "sloppy"; } }), Object) {};
    const f = held.f;
    return f() + " " + typeof A;
  },
  "arguments.callee in a field initializer's function"() {
    class A { f = function () { return typeof arguments.callee; }; }
    return new A().f();
  },
  "arguments and parameters in a field initializer's function are not one"() {
    class A { f = function (a) { arguments[0] = 2; return a; }; }
    return new A().f(1);
  },
  "a primitive receiver stays one"() {
    class A { f = function () { return typeof this; }; }
    return new A().f.call(1);
  },
  "behind the class the code is sloppy again"() {
    class A { f = 1; }
    const f = function () { return this === undefined ? "strict" : "sloppy"; };
    return f() + " " + new A().f + " " + which.length;
  },
};
