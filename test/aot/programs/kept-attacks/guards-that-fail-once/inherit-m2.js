// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Base { static get value() { return 1; } }
class Below extends Base {}
Object.defineProperty(Base, "val" + (process.argv[9] ?? "ue"), { value: 2, configurable: true });
function viaBelow() { let sum = 0; for (let i = 0; i < rounds; i++) sum = (sum + Below.value + i) | 0; return sum; }
function viaBase() { let sum = 0; for (let i = 0; i < rounds; i++) sum = (sum + Base.value + i) | 0; return sum; }
console.log(viaBelow(), viaBase(), viaBelow());
