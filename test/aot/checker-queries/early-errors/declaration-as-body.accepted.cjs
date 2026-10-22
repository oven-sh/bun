// Annex B: in sloppy mode code a plain function can be the body of if, else or a label.
if (1) function f() {}
if (1) ; else function f() {}
label: function f() {}
a: b: function f() {}
if (1) var a;
