// `eval` and `arguments` as the name of a class and as a target that is not itself the operand of an assignment are EarlyError in strict mode code and are not reported in sloppy mode code.
var o = {};
class eval {}
[arguments] = [];
({ eval } = o);
for (eval of []) {}
(arguments) = 1;
class C { m() { [eval] = []; } }
[o.eval] = [];
export {};
