// Sloppy mode code allows with, delete of a name, legacy octal literals and escapes, 08 and "\8", and eval, arguments and the reserved words of strict mode as names.
with ({}) {}
var a; delete a;
010;
08;
"\101";
"\8";
var eval;
var let = 1;
var public = 1, static = 2, yield = 3;
function f(eval, arguments) {}
var implements, interface, package, private, protected;
// Not listed: eval = 1; arguments = 1; var await; "\01"; ECMAScript allows them in sloppy mode code and bun run's parser rejects them.
// ECMAScript rejects the next five. bun run starts them: its transpiler prints the value of a legacy octal literal or escape and of "\8".
function f() { "use strict"; 010; }
"use strict"; 010;
"use strict"; var a = "\101";
class C { m() { 010; } }
class C { a = "\8"; }
// ECMAScript rejects the next two. bun run starts them: its transpiler removes the "use strict" directive of a function, so JavaScriptCore reads sloppy mode code.
function f(eval) { "use strict"; }
function f() { "use strict"; delete f; }
