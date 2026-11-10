// A name that a method first stores is listed among the class's fields and is not there at birth: the look asks nothing of it.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: counter:StructuresOfHeirsRefused = 0
class H extends Map { constructor(ttl) { super(); this.n = 1; } two() { return this.n + 1; } reset() { this.hits = 0; } }
const one = new H(Number(process.argv[3] ?? 0));
for (let k = 0; k < 9; k++) one.set(k, k);
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + one.two()) & 4095; return s; }
const turns = Number(process.argv[2] ?? 3000);
let sum = 0;
for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003;
console.log("SAID", sum, one.size);
