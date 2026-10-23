// Declarations as a body that Annex B does not allow in sloppy mode code either.
while (0) function f() {}
if (1) label: function f() {}
while (0) label: function f() {}
if (1) async function f() {}
if (1) function* g() {}
if (1) class C {}
label: async function f() {}
with ({}) function f() {}
