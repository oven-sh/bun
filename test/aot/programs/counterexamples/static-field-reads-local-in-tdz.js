// A static field initializer that reads a `let` declared below the class throws a ReferenceError.
function f() { class C { static x = n; } let n = {}; return C.x; }
try { console.log("no throw: " + f()); } catch (e) { console.log(e.name); }
