// Strict mode code in a CommonJS module: after a "use strict" directive and in a class.
"use strict"; with ({}) {}
function f() { "use strict"; var public; }
"use strict"; function f(eval) {}
"use strict"; function f() { delete f; }
class C { m() { with ({}) {} } }
class C { m() { var let; } }
class C extends (function () { with ({}) {} }) {}
