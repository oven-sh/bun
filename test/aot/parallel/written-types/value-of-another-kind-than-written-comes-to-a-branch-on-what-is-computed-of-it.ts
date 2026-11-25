// a parameter is written as a number, a branch goes by what is computed of it, and values of every other kind are handed over
let log = "";
function subject(n: number) { const cube = n * n * n; if (cube > 100) return "large" + String(cube); return "small" + String(cube); }
function deed(n: unknown) { try { return subject(n as number); } catch (e) { return (e as Error).name; } }
console.log(deed(2), deed(5), deed(-5), deed(0.5), deed(NaN), deed(-0));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 9).length;
console.log(String(lengths));
console.log(deed("5"), deed(null), deed(undefined), deed(true), deed([6]), deed({}), deed(5n), deed(Symbol("s")));
console.log(deed({ valueOf() { log += "v"; return 7; } }), log);
