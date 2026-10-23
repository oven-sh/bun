// A declaration as the body of if, a loop or a label, where only a statement is allowed.
if (1) let a;
if (1) const a = 1;
if (1) class C {}
while (0) function f() {}
for (;0;) class C {}
do function f() {} while (0);
if (1) async function f() {}
if (1) function* g() {}
label: class C {}
