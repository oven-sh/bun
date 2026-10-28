// Sloppy code: the parameter that becomes the heritage is changed through `arguments`, by a default, by an assignment, by a closure.
var lines = [];
class Base { kind() { return "base"; } }
class Other { kind() { return "other"; } }
function throughArguments(Parent) { arguments[0] = Other; return class extends Parent { field = 1; }; }
function assigned(Parent) { Parent = Other; return class extends Parent { field = 2; }; }
function withDefault(Parent = Other) { return class extends Parent { field = 3; }; }
function byClosure(Parent) { var swap = function () { Parent = Other; }; swap(); return class extends Parent { field = 4; }; }
function byEval(Parent) { eval("Parent = Other"); return class extends Parent { field = 5; }; }
function secondOfTwo(First, Parent) { return class extends Parent { field = 6; }; }
function rest(...all) { var Parent = all[1]; return class extends Parent { field = 7; }; }
class A extends throughArguments(Base) {}
class B extends assigned(Base) {}
class C extends withDefault(undefined) {}
class D extends withDefault(Base) {}
class E extends byClosure(Base) {}
class F extends byEval(Base) {}
class G extends secondOfTwo(Base, Other) {}
class H extends secondOfTwo(Other, Base) {}
class I extends rest(Base, Other) {}
for (var K of [A, B, C, D, E, F, G, H, I]) { var made = new K(); lines.push(K.name + ":" + made.kind() + made.field + (made instanceof Base ? "b" : "") + (made instanceof Other ? "o" : "")); }
console.log(lines.join(" "));
