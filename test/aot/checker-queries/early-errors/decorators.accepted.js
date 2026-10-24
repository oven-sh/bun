// Names, member chains and one call of either as decorators. Parentheses allow any expression.
var a; @a class C {}
var a = {}; @a.b.c class C {}
var a = {}; @a.b() class C {}
var a = []; @(a[0]) class C {}
var a; @(a().b) class C {}
var a; @(a?.b) class C {}
var a; class C { @a m() {} }
var a; class C { @(a().b) m() {} }
var a = []; class C { @(a[0]) a = 1; }
var a; (@(a()()) class {});
class C { static #a() {} static m() { class D { @C.#a m() {} } } }
