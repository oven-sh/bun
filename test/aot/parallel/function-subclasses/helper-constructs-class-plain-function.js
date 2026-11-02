// The first objects have the prototype object of the class. Then the helper is handed a plain function as new.target.
class Made {
  who() {
    return "c";
  }
}
function Target() {}
Target.prototype.who = function () {
  return "f";
};
function make(target) {
  return Reflect.construct(Made, [], target);
}
let answers = "";
for (let turn = 0; turn < 4; turn++) {
  const made = make(turn < 2 ? Made : Target);
  answers += made.who();
}
console.log(answers);
