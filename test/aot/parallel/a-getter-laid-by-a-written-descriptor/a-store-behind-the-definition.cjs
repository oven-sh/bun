function store(names, value) { names.add = value; return names.add; }
const names = {};
Object.defineProperty(names, "add", { get() { return 7; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += store(names, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), names.add);
