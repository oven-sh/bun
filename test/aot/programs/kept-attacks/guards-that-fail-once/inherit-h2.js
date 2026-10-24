// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Base { m() { return 1; } }
class Below extends Base {}
Base.prototype["" + (process.argv[9] ?? "m")] = () => 2;
const N = Number(process.argv[2] ?? 2);
function call() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Below.prototype.m()) | 0; return sum; }
console.log(call());
