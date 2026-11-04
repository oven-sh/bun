// a loop reads a name that neither a class nor its objects have, and in one of its turns an accessor is laid under the name on the object itself
class Plain { constructor() { this.side = 3; } }
const moved = new Plain();
Object.setPrototypeOf(moved, { extra: 5 });
function subject(plain, n, at) { let total = 0; for (let i = 0; i < n; i++) { if (i === at) Object.defineProperty(plain, "extra", { get() { return 5; }, configurable: true }); if (plain.extra === undefined) total += 1; else total += 100; } return total; }
function deed() { return subject(new Plain(), 4, 2); }
console.log(String(subject(new Plain(), 4, 9)) + "," + String(subject(moved, 2, 9)));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(new Plain(), 4, 9)));
