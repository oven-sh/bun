// a loop reads a name that neither a class nor its objects have, and in one of its turns the name is laid on the prototype object of the class under a computed key
class Plain { constructor() { this.side = 3; } }
const moved = new Plain();
Object.setPrototypeOf(moved, { extra: 5 });
function subject(plain, n, at, name) { let total = 0; for (let i = 0; i < n; i++) { if (i === at) Object.getPrototypeOf(plain)[name] = 5; if (plain.extra === undefined) total += 1; else total += 100; } return total; }
function deed() { const answer = subject(new Plain(), 4, 2, "extra"); delete Plain.prototype.extra; return answer; }
console.log(String(subject(new Plain(), 4, 9, "extra")) + "," + String(subject(moved, 2, 9, "extra")));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(new Plain(), 4, 9, "extra")));
