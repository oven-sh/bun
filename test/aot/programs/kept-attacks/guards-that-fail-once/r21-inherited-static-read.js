// no trip: the class that has the property is read; trip: a subclass that inherits it is read. Variants: undeclared (stored under a computed key), declared (a static field), method (a static method is called).
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);
const variant = process.argv[4] ?? "undeclared";

class Base {
  static declared = 3;
  static method(i) { return i & 3; }
}
class Below extends Base {}
Base["undec" + (process.argv[9] ?? "lared")] = 3;

function undeclaredOwn() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Base.undeclared + i) | 0; return sum; }
function undeclaredInherited() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Below.undeclared + i) | 0; return sum; }
function declaredOwn() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Base.declared + i) | 0; return sum; }
function declaredInherited() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Below.declared + i) | 0; return sum; }
function methodOwn() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Base.method(i)) | 0; return sum; }
function methodInherited() { let sum = 0; for (let i = 0; i < N; i++) sum = (sum + Below.method(i)) | 0; return sum; }
const runs = { undeclared: [undeclaredOwn, undeclaredInherited], declared: [declaredOwn, declaredInherited], method: [methodOwn, methodInherited] };
console.log(runs[variant][trip ? 1 : 0]());
