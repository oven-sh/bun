// Member names and modifiers that a class does not allow: constructor, prototype, #constructor, static twice, two base classes, a comma expression as a computed name.
class C { constructor() {} constructor() {} }
class C { *constructor() {} }
class C { get constructor() {} }
class C { set constructor(v) {} }
class C { async constructor() {} }
class C { async *constructor() {} }
class C { constructor = 1; }
class C { "constructor" = 1; }
class C { static constructor = 1; }
class C { static prototype = 1; }
class C { static prototype() {} }
class C { static get prototype() {} }
class C { #constructor; }
class C { #constructor() {} }
class C { static static a; }
class C extends A, B {}
class C { [a, b] = 1; }
class C { set [a, b](v = 1) {} }
