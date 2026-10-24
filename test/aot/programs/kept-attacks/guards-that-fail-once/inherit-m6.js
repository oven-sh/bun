// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Other { static method() { return 5; } }
class Base { static method() { return 1; } }
class Below extends Base {}
if (process.argv.length > 20) Object.setPrototypeOf(Below, Other);
Base["met" + (process.argv[9] ?? "hod")] = () => 2;
function viaBelow() { let sum = 0; for (let i = 0; i < rounds; i++) sum = (sum + Below.method() + i) | 0; return sum; }
function viaBase() { let sum = 0; for (let i = 0; i < rounds; i++) sum = (sum + Base.method() + i) | 0; return sum; }
console.log(viaBelow(), viaBase(), viaBelow());
