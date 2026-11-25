const turns = +process.argv[2] || 200;
function world(from) { let made = from; class P { constructor(x) { this.x = x; made++; } next() { return new this.constructor(this.x + 1); } } return { P, count() { return made; } }; }
const one = world(turns & 1);
let p = new one.P(0), sum = 0;
for (let i = 0; i < turns; i++) { p = p.next(); sum += p.x; }
console.log(sum, one.count(), p instanceof one.P);
