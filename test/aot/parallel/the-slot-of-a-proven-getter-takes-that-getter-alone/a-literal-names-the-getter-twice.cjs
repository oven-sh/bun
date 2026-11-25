function make(base) { return { held: base, get size() { return this.held; }, get size() { return this.held * 3; } }; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += make(i).size; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
