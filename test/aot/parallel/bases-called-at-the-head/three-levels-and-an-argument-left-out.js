// Three levels, each entered by `.call` at the head of the one below. Middle leaves an argument of Top out, and Top goes on behind its stores, so what Middle and Low store behind the call may not be there when seen() looks.
function Top(a, b) { this.a = a; this.b = b; seen(this); }
function Middle(a) { Top.call(this, a); this.c = 3; }
function Low(a, d) { Middle.call(this, a); this.d = d; }
Object.setPrototypeOf(Middle.prototype, Top.prototype);
Object.setPrototypeOf(Low.prototype, Middle.prototype);
const looks = [];
function seen(object) { if (looks.length < 3) looks.push(Object.keys(object).join()); }
function run(count) { let sum = 0; let last; for (let i = 0; i < count; i++) { last = new Low(i, 4); sum += last.a + last.c + last.d + (last.b === undefined ? 1 : 100); } return sum + ":" + Object.keys(last).join(); }
console.log(run(10), looks.join(" "));
