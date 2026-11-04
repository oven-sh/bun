// A loop reads a field of an object made ahead of it and stores the object itself into that field.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class Node { constructor() { this.self = null; this.n = 0; } }
function run(o, n) { let count = 0; for (let i = 0; i < n; i++) { if (o.self !== null) count++; if (i === 20) o.self = o; } return count; }
const a = new Node(), b = new Node();
console.log(run(a, 10), a.self === null, run(a, 40), a.self === a, run(b, 21), b.self === b, run(b, 5), b.self === b);
