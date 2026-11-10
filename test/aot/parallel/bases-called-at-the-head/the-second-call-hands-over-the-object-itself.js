// `this` is no value that a birth can list: the collection ends at that store without a second key, and `a` of the first call is listed.
// STATISTIC: ConstructorFieldsFoldedIntoAllocations = 1
function Top(a) { this.a = a; }
function Own(a) { Top.call(this, a); Top.call(this, this); this.b = 2; }
Object.setPrototypeOf(Own.prototype, Top.prototype);
const show = o => Object.keys(o).join("") + (o.a === o ? "@" : o.a);
function run(count) { let text = ""; for (let i = 0; i < count; i++) text += show(new Own(i)) + ";"; return text; }
console.log(run(process.argv.length + 1));
