// a literal with its keys in one order on one side and in another order on the other is spread into a new object, and the keys of the copy are listed
type Wide = { a?: unknown; b?: unknown; c?: unknown };
function subject(which: number, x: unknown): Wide { const more: Wide = which === 0 ? { a: x, b: x } : which === 1 ? { b: x, a: x } : which === 2 ? { c: x } : {}; return { ...more }; }
function deed(which: number, x: unknown) { const copy = subject(which, x); return Object.keys(copy).join("") + JSON.stringify(copy); }
console.log(deed(0, 1), deed(1, 2), deed(2, "x"), deed(3, null), deed(0, undefined));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += deed(i % 4, i).length;
console.log(String(lengths));
console.log(deed(JSON.parse("1"), JSON.parse("[1]")), deed(JSON.parse("0"), JSON.parse("{}")));
