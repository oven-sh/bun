// The errors the walk raises itself. A generator or an accessor named `constructor` is an EarlyError on the instance side, under a quoted name too. On the static side the rule is TypeScript's own.
class A { *constructor() {} }
class B { get constructor() { return 1; } }
class C { *"constructor"() {} }
class D { set "constructor"(value: number) {} }
class E { static *constructor() {} }
class F { static get constructor() { return 1; } }
class G { static *"constructor"() {} }
function thrower() { throw
new Error("after a line break"); }
with (A) { missing; }
