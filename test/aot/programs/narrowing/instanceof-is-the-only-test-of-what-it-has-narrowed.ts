// `x instanceof Derived` is a test for the layouts of Derived. The claim that the checker's narrowing brings behind it lists `undefined` and `null` beside them: whatever has passed the first test
// passes the second, so one test is left.
// The functions are also called with a value that nobody follows, so their parameters keep the types that are written.
// IRT= 1 conditional = TypeTest
// IRT= 1 leavesEarly = TypeTest
class Base { p = 1; }
class Derived extends Base { q = 2; r = 3; }
class Other extends Base { s = 4; }
function conditional(x: Base) { return x instanceof Derived ? x.q + x.r : 0; }
function leavesEarly(x: Base) { if (!(x instanceof Derived)) return x.p; return x.q + x.r; }
function either(x: Base) { return x instanceof Derived ? x.q : x instanceof Other ? x.s : x.p; }
function unknownValue(e: unknown) { return e instanceof Derived ? e.q + e.r : -1; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
const every: any[] = [conditional, leavesEarly, either, unknownValue];
const strange: unknown[] = [];
if (stranger !== null) for (const f of every) strange.push(f(stranger));

const impostor = Object.create(Derived.prototype);
const values: Base[] = [new Base(), new Derived(), new Other(), new Derived()];
console.log(conditional(impostor), leavesEarly(impostor), either(impostor), unknownValue(impostor), unknownValue(null), unknownValue(7));
let sum = 0;
for (let i = 0; i < 4000; i++) { const x = values[i & 3]; sum += conditional(x) + leavesEarly(x) + either(x) + unknownValue(x); }
console.log(sum, strange.length);
