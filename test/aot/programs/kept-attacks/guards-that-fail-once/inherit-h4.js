// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Base {}
class Below extends Base {}
Base["undec" + (process.argv[9] ?? "lared")] = 3;
const N = Number(process.argv[2] ?? 2);
function has() { let sum = 0; for (let i = 0; i < N; i++) sum += "undeclared" in Below ? 1 : 0; return sum; }
function kind() { let text = ""; for (let i = 0; i < N; i++) text += typeof Below.undeclared; return text; }
function call() { let text = ""; for (let i = 0; i < N; i++) text += Below.undeclared?.toString(); return text; }
console.log(process.argv[3] === "kind" ? kind() : process.argv[3] === "call" ? call() : has());
