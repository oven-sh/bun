// An object of many fields holds the names that its methods store later in its own cell.
function Machine() {
  this.f0 = 0;
  this.f1 = 1;
  this.f2 = 2;
  this.f3 = 3;
  this.f4 = 4;
  this.f5 = 5;
  this.f6 = 6;
  this.f7 = 7;
  this.f8 = 8;
  this.f9 = 9;
  this.f10 = 10;
  this.f11 = 11;
  this.f12 = 12;
  this.f13 = 13;
  this.f14 = 14;
  this.f15 = 15;
  this.f16 = 16;
  this.f17 = 17;
  this.f18 = 18;
  this.f19 = 19;
  this.f20 = 20;
  this.f21 = 21;
  this.f22 = 22;
  this.f23 = 23;
  this.f24 = 24;
  this.f25 = 25;
  this.f26 = 26;
  this.f27 = 27;
  this.f28 = 28;
  this.f29 = 29;
  this.f30 = 30;
  this.f31 = 31;
  this.f32 = 32;
  this.f33 = 33;
  this.f34 = 34;
  this.f35 = 35;
  this.f36 = 36;
  this.f37 = 37;
  this.f38 = 38;
  this.f39 = 39;
  this.f40 = 40;
  this.f41 = 41;
  this.f42 = 42;
  this.f43 = 43;
  this.f44 = 44;
  this.f45 = 45;
  this.f46 = 46;
  this.f47 = 47;
  this.f48 = 48;
  this.f49 = 49;
  this.f50 = 50;
  this.f51 = 51;
  this.f52 = 52;
  this.f53 = 53;
  this.f54 = 54;
  this.f55 = 55;
  this.f56 = 56;
  this.f57 = 57;
  this.f58 = 58;
  this.f59 = 59;
  this.f60 = 60;
  this.f61 = 61;
  this.f62 = 62;
  this.f63 = 63;
  this.f64 = 64;
  this.f65 = 65;
}
Machine.prototype.late3 = "default";
Machine.prototype.start = function (step) {
  this.late0 = 0 * step;
  this.late1 = 1 * step;
  this.late2 = 2 * step;
  this.late3 = 3 * step;
  this.late4 = 4 * step;
  this.late5 = 5 * step;
  this.late6 = 6 * step;
  this.late7 = 7 * step;
  this.late8 = 8 * step;
  this.late9 = 9 * step;
  this.late10 = 10 * step;
  this.late11 = 11 * step;
  this.late12 = 12 * step;
  this.late13 = 13 * step;
  this.late14 = 14 * step;
  this.late15 = 15 * step;
  this.late16 = 16 * step;
  this.late17 = 17 * step;
  this.late18 = 18 * step;
  this.late19 = 19 * step;
  this.late20 = 20 * step;
  this.late21 = 21 * step;
  this.late22 = 22 * step;
  this.late23 = 23 * step;
  return this;
};
Machine.prototype.turn = function () {
  this.late0 = (this.late0 + 1) & 7;
  if (--this.late1 < 0) this.late1 = 5;
  this.late2 += this.late0 * this.late1;
  return this.late2;
};
Machine.prototype.describe = function () {
  return [this.late0, this.late1, this.late3, "late3" in this, Object.hasOwn(this, "late3"), Object.hasOwn(this, "late23"), Object.keys(this).length].join();
};
class Derived extends Machine {
  constructor() { super(); this.own = "own"; }
  restart() { return this.start(3); }
}

const early = new Machine();
console.log(early.describe(), early.late5, early.late23);
console.log(early.start(1).describe(), early.late5, early.late23);
let total = 0;
for (let turn = 0; turn < 1000; turn++) total = (total + early.turn()) | 0;
console.log(total, early.late0, early.late1, early.late2);

const parted = new Machine().start(2);
delete parted.late1;
console.log(parted.describe(), parted.late1, Object.keys(parted).slice(64).join());
parted.late1 = "again";
console.log(parted.describe(), Object.keys(parted).slice(64).join());
for (let turn = 0; turn < 5; turn++) console.log(parted.turn());

const frozen = Object.freeze(new Machine().start(4));
for (let turn = 0; turn < 3; turn++) {
  try { frozen.turn(); } catch (error) { console.log(error.name, frozen.late0, frozen.late1); }
}
const sealed = Object.seal(new Machine());
try { sealed.start(5); } catch (error) { console.log(error.name, sealed.describe()); }

const accessed = new Machine();
Object.defineProperty(accessed, "late2", { get() { return 70; }, set(value) { this.late4 = value; }, configurable: true, enumerable: true });
accessed.start(1);
for (let turn = 0; turn < 3; turn++) console.log(accessed.turn(), accessed.late4, accessed.describe());

const derived = new Derived();
console.log(derived.describe(), derived.own, derived.late2);
console.log(derived.restart().describe(), Object.keys(derived).slice(62, 72).join());
for (let turn = 0; turn < 50; turn++) total = (total + derived.turn()) | 0;
console.log(total, JSON.stringify(derived).length, JSON.stringify({ ...derived }).length);

const odd = [1.5, -0, NaN, 2 ** 31, 2 ** 32, 2 ** 53, "text", undefined, null, 10n, true, {}, []];
for (const value of odd) {
  const machine = new Machine();
  machine.start(1);
  machine.late0 = value;
  machine.late1 = value;
  machine.late2 = "";
  let said;
  try { said = machine.turn(); } catch (error) { said = error.name; }
  console.log(typeof value, String(said), String(machine.late0), String(machine.late1), Object.is(machine.late1, -0));
}
const many = [];
for (let count = 0; count < 200; count++) many.push(count % 3 ? new Machine().start(count) : new Machine());
let filled = 0;
for (const machine of many) filled += (machine.late23 === undefined ? 1 : 0) + (machine.late3 === "default" ? 100 : 0);
console.log(filled);
