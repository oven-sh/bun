// new.target comes out of a list: the class itself and a plain function take turns.
class Made {
  who() {
    return "c";
  }
}
function Target() {}
Target.prototype.who = function () {
  return "f";
};
const targets = [Made, Target, Made, Target];
function run() {
  let answers = "";
  for (const target of targets) answers += Reflect.construct(Made, [], target).who();
  return answers;
}
console.log(run(), run());
