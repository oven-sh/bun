// Guards that fail once: t without2. It prints what plain Bun prints.
const rounds = Number(process.argv[2]);
function Without(x) { this.x = x; this.y = 2; }
Without.prototype.m = function () { return this.x; };
function Other(x) { this.x = x; }
Other.prototype.y = 0;
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += new Without(i).y; return s; }
console.log(run(rounds), new Other(1).y);
