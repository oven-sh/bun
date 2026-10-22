// Strict mode code allows eval and arguments as property names and as values.
var o = {}; [o.eval] = []; ({ eval: o.arguments } = {});
var o = {}; for (o.eval of []) {}
var o = {}; (o.arguments) = 1; (o.eval)++;
var a; [a = eval] = [];
var a; ({ a = eval } = {});
var a = [eval], b = { eval };
var { eval: a } = {};
class C { eval() {} static arguments() {} }
var a; export { a as eval };
function f() { return [arguments]; }
function f() { var a; [a] = arguments; }
function f() { var a; for (a of arguments) {} }
