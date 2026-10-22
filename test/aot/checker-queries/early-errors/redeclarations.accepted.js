// A name declared twice where that is allowed: var, a nested scope, a getter with its setter, public class members, one binding exported under two names.
var a; var a;
function f(a) { var a; }
try {} catch (e) { var e; }
let a; { let a; }
function f() { let a; } function g() { let a; }
class C { get #a() { return 1; } set #a(v) {} }
class C { a; a; m() {} m() {} }
switch (0) { case 0: { let a; } case 1: { let a; } }
const a = 1; export { a, a as b };
// ECMAScript rejects the next three. bun run starts them: its transpiler removes a function declaration that a later one of the same name overwrites.
function f() {} function f() {}
function* f() {} function* f() {}
{ function f() {} function f() {} }
