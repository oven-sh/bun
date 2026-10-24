// super() outside of the constructor of a derived class, and super.name outside of methods, accessors, field initializers and static blocks.
super();
super.a;
function f() { super.a; }
function f() { super(); }
class C { constructor() { super(); } }
class C extends Object { m() { super(); } }
class C extends Object { a = super(); }
class C extends Object { static { super(); } }
({ a: function () { super.b; } });
({ a() { super(); } });
class C extends Object { constructor() { function f() { super(); } } }
class C { m() { function f() { super.a; } } }
() => super.a;
class C extends Object { [super.a]() {} }
