// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Base { static method() { return 1; } }
class Below extends Base {}
delete Base["met" + (process.argv[9] ?? "hod")];
function viaBelow() { let text = ""; for (let i = 0; i < rounds; i++) text += typeof Below.method + " "; return text; }
function viaBase() { let text = ""; for (let i = 0; i < rounds; i++) text += typeof Base.method + " "; return text; }
console.log(viaBelow(), viaBase(), viaBelow());
