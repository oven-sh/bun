// A block or a var statement in the same positions.
if (1) { function f() {} }
if (1) var a;
label: { class C {} }
// ECMAScript rejects the next four in strict mode code. bun run starts them: its transpiler turns the function into a let declaration in a block.
if (1) function f() {}
if (1) ; else function f() {}
label: function f() {}
a: b: function f() {}
