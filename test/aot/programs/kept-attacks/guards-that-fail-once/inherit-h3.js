// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Base { static method() { return 1; } }
class Below extends Base {}
class Lowest extends Below {}
Below["met" + (process.argv[9] ?? "hod")] = () => 2;
const N = Number(process.argv[2] ?? 2);
function call() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Lowest.method()) | 0; return sum; }
function has() { let sum = 0; for (let i = 0; i < N; i++) sum += "method" in Lowest ? 1 : 0; return sum; }
console.log(call(), has());
