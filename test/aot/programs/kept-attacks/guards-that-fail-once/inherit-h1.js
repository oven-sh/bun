// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Base {}
class Below extends Base {}
Base.prototype["undec" + (process.argv[9] ?? "lared")] = 3;
const N = Number(process.argv[2] ?? 2);
function read() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Below.prototype.undeclared + i) | 0; return sum; }
console.log(read());
