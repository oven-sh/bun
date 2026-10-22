// arguments in a field initializer or a static block, also through arrow functions and computed member names.
class C { a = arguments; }
class C { static a = arguments; }
class C { a = () => arguments; }
class C { static { arguments; } }
class C { static { (() => arguments)(); } }
function f() { class C { a = arguments; } }
class C { a = class { [arguments]() {} }; }
