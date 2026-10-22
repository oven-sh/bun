// A class below RangeError is defined in a loop: each turn makes a class of its own.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const made = [];
for (let turn = 0; turn < 3; turn++) {
  class Late extends RangeError {
    method() {
      return "method of " + this.constructor.name;
    }
    static fixed() {
      return "static of " + this.name;
    }
  }
  made.push(Late);
}
tell("three classes", () => [made[0] === made[1], made[1] === made[2], new made[0]("m") instanceof made[1], new made[2]("m") instanceof made[2], made[1].fixed()].join(" "));
