// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Other { static method() { return 5; } }
class Base {}
class Below extends Base {}
Object.setPrototypeOf(Base, process.argv.length > 20 ? Function.prototype : Other);
function viaBelow() { let text = ""; for (let i = 0; i < rounds; i++) text += typeof Below.method + " "; return text; }
function viaBase() { let text = ""; for (let i = 0; i < rounds; i++) text += typeof Base.method + " "; return text; }
console.log(viaBelow(), viaBase(), viaBelow());
