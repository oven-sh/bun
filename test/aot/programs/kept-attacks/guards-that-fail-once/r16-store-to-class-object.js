// Guards that fail once: store to class object. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);

class Declared {
  static count = 0;
}
class Undeclared {}
Undeclared["co" + (process.argv[9] ?? "unt")] = 0;

function runDeclared() {
  for (let i = 0; i < N; i++) Declared.count++;
  return Declared.count;
}
function runUndeclared() {
  for (let i = 0; i < N; i++) Undeclared.count++;
  return Undeclared.count;
}
console.log(trip ? runUndeclared() : runDeclared());
