// return in a function, also in a function in a static block, and throw with its operand on the same line.
function f() { return; }
() => { return; };
throw 1;
class C { static { (() => { return; })(); } }
