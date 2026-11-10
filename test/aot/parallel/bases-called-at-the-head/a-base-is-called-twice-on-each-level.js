// Each level calls the one above twice. The build used to read a base once for each way down to it: twice as often with every level.
// STATISTIC: BodiesReadForBirths <= 100
// STATISTIC: FieldsListedAtBirthsByConstructors = 0
function F0() { this.a = 1; }
function F1() { F0.call(this); F0.call(this); this.f1 = 1; }
Object.setPrototypeOf(F1.prototype, F0.prototype);
function F2() { F1.call(this); F1.call(this); this.f2 = 2; }
Object.setPrototypeOf(F2.prototype, F1.prototype);
function F3() { F2.call(this); F2.call(this); this.f3 = 3; }
Object.setPrototypeOf(F3.prototype, F2.prototype);
function F4() { F3.call(this); F3.call(this); this.f4 = 4; }
Object.setPrototypeOf(F4.prototype, F3.prototype);
function F5() { F4.call(this); F4.call(this); this.f5 = 5; }
Object.setPrototypeOf(F5.prototype, F4.prototype);
function F6() { F5.call(this); F5.call(this); this.f6 = 6; }
Object.setPrototypeOf(F6.prototype, F5.prototype);
function F7() { F6.call(this); F6.call(this); this.f7 = 7; }
Object.setPrototypeOf(F7.prototype, F6.prototype);
function F8() { F7.call(this); F7.call(this); this.f8 = 8; }
Object.setPrototypeOf(F8.prototype, F7.prototype);
function F9() { F8.call(this); F8.call(this); this.f9 = 9; }
Object.setPrototypeOf(F9.prototype, F8.prototype);
function F10() { F9.call(this); F9.call(this); this.f10 = 10; }
Object.setPrototypeOf(F10.prototype, F9.prototype);
function run(count) { let sum = 0, last; for (let i = 0; i < count; i++) { last = new F10(); sum += last.f10 + last.a; } return sum + " " + Object.keys(last).join(); }
console.log(run(3));
