// super() in the constructor of a derived class and super.name in a method, an accessor, a field initializer or a static block, also through arrow functions.
class C extends Object { constructor() { super(); } }
class C extends Object { constructor() { (() => super())(); } }
class C { m() { super.a; } }
class C { static m() { super.a; } }
({ m() { super.a; } });
({ get a() { return super.a; } });
class C { a = super.b; }
class C { static { super.a; } }
class C { m() { () => super.a; } }
class C extends Object { constructor(a = super()) {} }
class D { m() { class C { [super.a]() {} } } }
