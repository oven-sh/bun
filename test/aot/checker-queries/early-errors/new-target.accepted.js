// new.target in functions, methods, accessors, field initializers and static blocks.
function f() { new.target; }
function f() { () => new.target; }
class C { constructor() { new.target; } }
class C { m() { new.target; } }
class C { get a() { return new.target; } }
class C { a = new.target; }
class C { static { new.target; } }
({ m() { new.target; } });
