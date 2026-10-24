// Strict mode code allows delete of a property, reserved words as property names, 0o10 and "\0".
var a = {}; delete a.b;
var o = { eval: 1, public: 2, let: 3 };
var o = {}; o.static; o.let; o.yield;
0o10;
"\0";
// ECMAScript rejects the next five in a module. bun run starts them: a with statement makes the file a CommonJS module, and its transpiler prints the value of a legacy octal literal or escape, of 08 and of "\8".
with ({}) {}
010;
08;
"\101";
"\8";
