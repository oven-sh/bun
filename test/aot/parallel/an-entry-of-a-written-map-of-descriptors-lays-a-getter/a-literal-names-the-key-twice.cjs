function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = {};
Object.defineProperties(lib, { add: { get: function () { return add; } }, add: { enumerable: true, get: function () { return sub; } } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)));
