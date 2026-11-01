// The loop runs on a class whose field holds fractions and on a look-alike literal whose field also holds an integer.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class Acc { constructor() { this.a = 0.5; } }
function lookalike() { return { a: 7, extra: 1 }; }
function read(each) { return each.a; }
function run(o, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += read(o); if (i === 3) o.a = 2.5; } return sum; }
const c = new Acc(), l = lookalike();
console.log(read(l), run(c, 2), c.a, run(c, 6), c.a, run(l, 2), l.a, run(l, 6), l.a, [1, 2, 3][l.a - 1.5 | 0]);
