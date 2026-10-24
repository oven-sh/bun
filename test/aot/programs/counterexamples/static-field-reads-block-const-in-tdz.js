// A static field initializer that reads a `const` declared below the class in the same block throws a ReferenceError.
try { class C { static x = y; } const y = {}; console.log(C.x); } catch (e) { console.log(e.name); }
