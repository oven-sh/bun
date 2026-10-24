// Strict mode code in a CommonJS module: a class with its name, and after a "use strict" directive.
class eval {}
(class arguments {});
class C { m() { [eval] = []; } }
class C { m() { for (arguments in {}) {} } }
class C extends (function () { (eval) = 1; }) {}
"use strict"; [eval] = [];
"use strict"; ({ arguments } = {});
"use strict"; for (eval of []) {}
"use strict"; (arguments)++;
