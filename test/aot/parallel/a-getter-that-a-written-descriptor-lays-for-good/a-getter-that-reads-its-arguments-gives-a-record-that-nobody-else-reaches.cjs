const inner = { run(a) { return a + 1; } };
const lib = { base: 1 };
Object.defineProperty(lib, "tool", { enumerable: true, get: function () { return arguments[0] === undefined ? inner : null; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = lib.tool.run(s); return s; }
console.log(drive(+(process.argv[2] ?? 50)));
