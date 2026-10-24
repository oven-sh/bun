// `u.a = f()` with u undefined evaluates the right side before it throws.
try { u.a = console.log("right side"); } catch (e) { console.log("caught"); }
var u = exports;
