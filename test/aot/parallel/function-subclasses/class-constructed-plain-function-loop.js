// Reflect.construct makes an object of the class with the prototype object of the function, so the method of the function is the one that is found.
class Made {
  who() {
    return "class";
  }
}
function Target() {}
Target.prototype.who = function () {
  return "function";
};
for (let turn = 0; turn < 1; turn++) {
  console.log(Reflect.construct(Made, [], Target).who());
}
