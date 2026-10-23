// break and continue with no target in the same function or static block, and a label inside a label of the same name.
break;
continue;
a: { continue a; }
while (0) { break missing; }
a: a: ;
a: { a: ; }
while (0) { function f() { break; } }
a: while (0) { function f() { break a; } }
switch (0) { case 0: continue; }
class C { static { break; } }
a: while (0) { class C { static { continue a; } } }
