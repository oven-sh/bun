// a value that is a number on one side and a text on the other is tested for its type, and a closure that is made behind the test reads it later
function subject(c: unknown, n: number) { const v = c ? n : "t" + n; if (typeof v === "number") return () => v + 1; return () => v + "!"; }
function deed(c: unknown, n: number) { return String(subject(c, n)()); }
console.log(deed(true, 1), deed(false, 1), deed(0, 2.5), deed("x", -0), deed(null, NaN));
const made: Array<() => unknown> = [];
for (let i = 0; i < 300; i++) made.push(subject(i % 3, i));
let out = "";
for (let i = 0; i < 300; i += 37) out += String(made[i]()) + ",";
console.log(out);
console.log(deed(JSON.parse("1"), JSON.parse("7")), deed(JSON.parse("null"), JSON.parse("7")));
