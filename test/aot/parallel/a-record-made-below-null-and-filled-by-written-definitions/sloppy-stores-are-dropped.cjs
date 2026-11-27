const names = Object.create(null);
Object.defineProperty(names, "fixed", { value: 1 });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { names.fixed = i; s += names.fixed; } return s; }
console.log(drive(+(process.argv[2] ?? 50)), delete names.fixed, names.fixed);
