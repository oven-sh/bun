// The loop calls a method on the object of the turn before and then makes the next one, from the second turn on with the prototype object of a plain function.
class Made {
  who() {
    return "c";
  }
}
function Target() {}
Target.prototype.who = function () {
  return "f";
};
function run(turns) {
  let last = new Made();
  let answers = "";
  for (let turn = 0; turn < turns; turn++) {
    answers += last.who();
    last = Reflect.construct(Made, [], turn ? Target : Made);
  }
  return answers + last.who();
}
console.log(run(3));
