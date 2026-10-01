new Foo;
new Foo();
new (foo())();
new a.b.c;
new new X()();
new a.b(1)(2);
super.x;
class A extends B { constructor() { super(); super.m(); } static async *gen() {} static() {} 'constructor'() {} get 1() { return 1; } accessor z = 1; static accessor w; }
