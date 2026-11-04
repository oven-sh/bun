const log = [];
function Base(a) { log.push("base"); this.a = a; }
class Below extends Base { twice = (log.push("field"), this.a * 2); constructor(a) { log.push("in front"); super(a); log.push("behind"); this.b = this.twice + 1; } }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i).b; return t; }
console.log(run(3), log.join(" "), Object.keys(new Below(1)).join());
