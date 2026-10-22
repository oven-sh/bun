// break and continue with a target, one label name on two consecutive statements, and the name of an outer label in a class static block.
a: { break a; }
a: while (0) { continue a; }
a: ; a: ;
switch (0) { case 0: break; }
a: { b: { break a; } }
while (0) { switch (0) { case 0: continue; } }
a: { class C { static { a: for (;;) break a; } } }
