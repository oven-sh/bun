// A function expression makes a new object each time it is evaluated, also where it is stored as a member of a class or of a constructor function.
const lines = [];
function install(target) {
  target.prototype.run = function () {
    return 1;
  };
  return target.prototype.run;
}
function Job() {}
function Task() {}
function runOf(o) {
  return o.run;
}
const a = install(Job);
const job = new Job();
for (let i = 0; i < 3; i++) runOf(job);
lines.push("first " + (runOf(job) === a));
const b = install(Task);
const task = new Task();
for (let i = 0; i < 3; i++) runOf(task);
lines.push("second " + (runOf(task) === b) + " " + (a === b) + " " + (runOf(job) === a));
const c = install(Job);
lines.push("again " + (runOf(job) === c) + " " + (c === a) + " " + (runOf(new Job()) === c));
function makeClass() {
  return class {
    go() {
      return 2;
    }
  };
}
function goOf(o) {
  return o.go;
}
const One = makeClass();
const Two = makeClass();
const one = new One();
const two = new Two();
for (let i = 0; i < 3; i++) goOf(one), goOf(two);
lines.push("classes " + (goOf(one) === One.prototype.go) + " " + (goOf(two) === Two.prototype.go) + " " + (goOf(one) === goOf(two)));
function Plain() {}
Plain.prototype.go = Plain.prototype.run = function () {
  return 3;
};
const plain = new Plain();
lines.push("two names " + (goOf(plain) === runOf(plain)) + " " + (goOf(plain) === Plain.prototype.run));
function Shared() {}
Shared.prototype.go = Plain.prototype.go;
lines.push("two holders " + (goOf(new Shared()) === goOf(plain)));
console.log(lines.join("\n"));
