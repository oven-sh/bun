// Strict mode code, here a module: with, delete of a name, eval and arguments as targets or declared names, reserved words as names.
export {}; with ({}) {}
var a; delete a;
eval = 1;
arguments = 1;
eval++;
var eval;
function f(eval) {}
function arguments() {}
var let = 1;
var public = 1;
var static = 1;
var yield = 1;
var implements;
class static {}
const f = package => 1;
({ eval } = {});
[arguments] = [];
var await;
function await() {}
