// What Top lays is laid twice: no birth is listed. The second reading ends at its first store.
// STATISTIC: FieldsListedAtBirthsByConstructors = 0
function Top(a) { this.a = a; }
function Twice(a) { Top.call(this, a); Top.call(this, a); this.b = 2; }
Object.setPrototypeOf(Twice.prototype, Top.prototype);
const show = o => Object.keys(o).join("") + (o.a === o ? "@" : o.a);
function run(count) { let text = ""; for (let i = 0; i < count; i++) text += show(new Twice(i)) + ";"; return text; }
console.log(run(3));
