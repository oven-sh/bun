// The bases lay nothing and hand the object back. Only the last level stores, and its birth is listed. No store ends a second reading here: what is remembered of the first does.
// STATISTIC: BodiesReadForBirths <= 100
// STATISTIC: FieldsListedAtBirthsByConstructors = 1
function E0() { return this; }
function E1() { E0.call(this); E0.call(this); }
Object.setPrototypeOf(E1.prototype, E0.prototype);
function E2() { E1.call(this); E1.call(this); }
Object.setPrototypeOf(E2.prototype, E1.prototype);
function E3() { E2.call(this); E2.call(this); }
Object.setPrototypeOf(E3.prototype, E2.prototype);
function E4() { E3.call(this); E3.call(this); }
Object.setPrototypeOf(E4.prototype, E3.prototype);
function E5() { E4.call(this); E4.call(this); }
Object.setPrototypeOf(E5.prototype, E4.prototype);
function E6() { E5.call(this); E5.call(this); }
Object.setPrototypeOf(E6.prototype, E5.prototype);
function E7() { E6.call(this); E6.call(this); }
Object.setPrototypeOf(E7.prototype, E6.prototype);
function E8() { E7.call(this); E7.call(this); }
Object.setPrototypeOf(E8.prototype, E7.prototype);
function E9() { E8.call(this); E8.call(this); }
Object.setPrototypeOf(E9.prototype, E8.prototype);
function E10() { E9.call(this); E9.call(this); }
Object.setPrototypeOf(E10.prototype, E9.prototype);
function Last(w) { E10.call(this); this.w = w; this.h = w + 1; }
Object.setPrototypeOf(Last.prototype, E10.prototype);
function run(count) { let sum = 0, last; for (let i = 0; i < count; i++) { last = new Last(i); sum += last.w + last.h; } return sum + " " + Object.keys(last).join(); }
console.log(run(10));
