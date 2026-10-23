// A decorator that is not a name, a member chain, one call of either, or an expression in parentheses.
@a().b class C {}
@a()() class C {}
@a?.b class C {}
@a.b?.() class C {}
@this.a class C {}
class C { @a().b m() {} }
class C { @a?.b a = 1; }
(@a().b class {});
