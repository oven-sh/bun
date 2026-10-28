// In each turn a method is called on an ordinary instance, on an object that Reflect.construct made with the prototype object of a function, and on the instance again.
class Made {
  who() {
    return "c";
  }
}
function Target() {}
Target.prototype.who = function () {
  return "f";
};
function run(instance, turns) {
  let answers = "";
  for (let turn = 0; turn < turns; turn++) {
    answers += instance.who();
    answers += Reflect.construct(Made, [], Target).who();
    answers += instance.who();
  }
  return answers;
}
console.log(run(new Made(), 3));
