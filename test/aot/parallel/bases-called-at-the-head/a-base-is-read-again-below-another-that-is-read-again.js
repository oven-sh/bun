// Twice is called twice, and calls Top twice: the second reading of Twice comes to Top, which is then read again too, and ends there.
// STATISTIC: FieldsListedAtBirthsByConstructors = 0
function Top(a) { this.a = a; }
function Same() { return this; }
function Twice(a) { Top.call(this, a); Top.call(this, a); this.b = 2; }
Object.setPrototypeOf(Twice.prototype, Top.prototype);
function Deep(a) { Twice.call(this, a); Same.call(this); Twice.call(this, a); this.c = 3; }
Object.setPrototypeOf(Deep.prototype, Twice.prototype);
const show = o => Object.keys(o).join("") + (o.a === o ? "@" : o.a);
function run(count) { let text = ""; for (let i = 0; i < count; i++) text += show(new Deep(i)) + ";"; return text; }
console.log(run(3));
