// The loop reads the field through a function that also takes a look-alike literal, whose field holds a string. The stores name the class alone.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class Acc { constructor() { this.a = 1e21; } }
function lookalike() { return { a: 0.5, extra: 1 }; }
function read(each) { return each.a; }
function run(o, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += read(o); if (i === 20) o.a = 2.5; if (i === 30) o.a = 1e300; } return sum; }
const c = new Acc(), l = lookalike();
l.a = "text";
console.log(read(l), run(c, 10), c.a, run(c, 25), c.a, run(c, 40), c.a);
