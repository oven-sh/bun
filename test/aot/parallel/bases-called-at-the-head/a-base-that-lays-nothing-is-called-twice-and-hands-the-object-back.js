// Same lays nothing and returns the object. What is remembered of its first reading answers for the second call, with the name that the result gives the object: `a` and `b` are listed.
// STATISTIC: FieldsListedAtBirthsByConstructors = 2
function Same() { return this; }
function Again(a) { var s = Same.call(this) || this; s.a = a; var u = Same.call(this) || this; u.b = 2; }
Object.setPrototypeOf(Again.prototype, Same.prototype);
const show = o => Object.keys(o).join("") + (o.a === o ? "@" : o.a);
function run(count) { let text = ""; for (let i = 0; i < count; i++) text += show(new Again(i)) + ";"; return text; }
console.log(run(process.argv.length + 1));
